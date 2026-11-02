import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {Viewer,RenderMode} from '@mkkellogg/gaussian-splats-3d';
import {WaterReflection} from '../local_lab/water-reflection.mjs';

const $=id=>document.getElementById(id),stage=$('stage');
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;
stage.append(renderer.domElement);
const camera=new THREE.PerspectiveCamera(43,1,.001,10);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
controls.minDistance=.16;controls.maxDistance=2;controls.maxPolarAngle=Math.PI*.49;
const scene=new THREE.Scene();scene.background=new THREE.Color('#23313b');
scene.add(new THREE.HemisphereLight(0xd5edff,0x25332d,1.5));
const light=new THREE.DirectionalLight(0xfff6e9,1.9);light.position.set(-.2,.5,.4);scene.add(light);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshBasicMaterial({color:0x17252b}));
ground.rotation.x=-Math.PI/2;ground.position.y=-.065;scene.add(ground);
const water=new WaterReflection(renderer,scene);
water.material.color.set(0x18373e);water.material.roughness=.06;water.material.opacity=.98;
water.uniforms.waterScale.value=.13;
const originalWater=new THREE.MeshPhysicalMaterial({color:0x234951,roughness:.12,metalness:0,transparent:true,opacity:.95,side:THREE.DoubleSide});
const mirrorScene=new THREE.Scene();mirrorScene.background=scene.background.clone();
const target=new THREE.WebGLRenderTarget(1000,620,{type:THREE.HalfFloatType,depthBuffer:true});
water.uniforms.waterReflection.value=target.texture;
const options={renderer,camera,selfDrivenMode:false,useBuiltInControls:false,dynamicScene:true,
  sharedMemoryForWorkers:globalThis.crossOriginIsolated===true&&typeof SharedArrayBuffer!=='undefined',gpuAcceleratedSort:false,halfPrecisionCovariancesOnGPU:true,
  sphericalHarmonicsDegree:0,renderMode:RenderMode.Always,sceneRevealMode:0};
const mainViewer=new Viewer({...options,threeScene:scene});
const mirrorViewer=new Viewer({...options,threeScene:new THREE.Scene()});
const loader=new OBJLoader();
let report,meta,surface=null,collider=null,index=0,playing=false,loading=false,pending=null,last=0,ready=false;
let surfaceMeta,heights;
let referenceSurfaceHeight=null,level=0,captures=0,reflectionDirty=true;
const lastCamera=new THREE.Matrix4(),bias=new THREE.Matrix4().set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1);
function setView(low=true){camera.position.set(low?.34:.37,low?.10:.34,low?.43:.46);controls.target.set(0,.035,0);controls.update();reflectionDirty=true;}
setView();
function resize(){const {width,height}=stage.getBoundingClientRect();renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();
  const scale=Math.min(1,1100/width);target.setSize(Math.round(width*scale),Math.round(height*scale));water.uniforms.waterTexel.value.set(1/target.width,1/target.height);reflectionDirty=true;}
new ResizeObserver(resize).observe(stage);resize();
async function loadSurface(i){
  const {nx,nz,xmin,xmax,zmin,zmax}=surfaceMeta,n=nx*nz;
  if(!surface){
    const geometry=new THREE.BufferGeometry(),positions=new Float32Array(n*3),indices=[];
    for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
      const k=z*nx+x;positions[k*3]=xmin+(xmax-xmin)*x/(nx-1);positions[k*3+2]=zmin+(zmax-zmin)*z/(nz-1);
      if(x<nx-1&&z<nz-1)indices.push(k,k+nx,k+1,k+1,k+nx,k+nx+1);
    }
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setIndex(indices);
    surface=new THREE.Mesh(geometry,water.material);scene.add(surface);
  }
  const attribute=surface.geometry.attributes.position;
  for(let k=0;k<n;k++)attribute.setY(k,heights[i*n+k]);
  attribute.needsUpdate=true;surface.geometry.computeVertexNormals();surface.geometry.computeBoundingSphere();
  return surface;
}
function applyLevel(){
  if(!surface)return;
  surface.position.y=-referenceSurfaceHeight+level;
  // Fix the optical mean plane to the sole reference; SPH waves retain their
  // actual deviations from the frame-zero mean instead of recentering every frame.
  water.height=level;water.uniforms.waterHeight.value=level;
  water.uniforms.waterScale.value=.13;
  mirrorViewer.getSplatScene(0).position.y=2*level;
  reflectionDirty=true;
}
async function showFrame(i){
  if(loading){pending=i;return;}loading=true;
  try{
    const mesh=await loadSurface(i);if(surface)scene.remove(surface);surface=mesh;scene.add(mesh);
    if(referenceSurfaceHeight===null)referenceSurfaceHeight=surfaceMeta.reference_height;
    applyLevel();mesh.visible=$('water').checked;mesh.traverse(o=>{if(o.isMesh)o.material=$('reflect').checked?water.material:originalWater;});
    index=i;$('time').value=i;$('clock').value=report.frames[i].time.toFixed(2)+' s';
    $('metrics').textContent=`${meta.render_gaussians.toLocaleString()} 个鞋子高斯 · ${report.frames[i].fluid_0_count.toLocaleString()} 个真实 SPH 粒子 · ${i+1} / ${report.frame_count} 帧 · 鞋底基准 0 mm`;
  }finally{loading=false;if(pending!==null){const next=pending;pending=null;await showFrame(next);}}
}
function captureReflection(){
  const isVisible=$('reflect').checked&&$('water').checked&&camera.position.y>level;
  water.uniforms.waterCaptureValid.value=isVisible?1:0;
  if(!isVisible)return;
  camera.updateMatrixWorld(true);
  if(!reflectionDirty&&lastCamera.equals(camera.matrixWorld))return;
  mirrorViewer.update();
  // Each view has a separate GS instance, transform and sort worker. No main
  // camera ordering is reused for the mirrored shoe.
  const renderTarget=renderer.getRenderTarget(),autoClear=renderer.autoClear;
  const size=new THREE.Vector2(target.width,target.height);
  mirrorViewer.splatMesh.updateUniforms(size,camera.projectionMatrix.elements[0]*.5*size.x,
    camera.projectionMatrix.elements[5]*.5*size.y,false,1,1);
  try{
    renderer.setRenderTarget(target);renderer.autoClear=true;renderer.render(mirrorScene,camera);
  }finally{renderer.setRenderTarget(renderTarget);renderer.autoClear=autoClear;}
  water.uniforms.waterProjection.value.copy(bias).multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);
  lastCamera.copy(camera.matrixWorld);reflectionDirty=false;captures++;
}
$('play').onclick=()=>{playing=!playing;$('play').textContent=playing?'Ⅱ 暂停':'▶ 播放水波';};
$('time').oninput=()=>{playing=false;$('play').textContent='▶ 播放水波';showFrame(Number($('time').value));};
$('low').onclick=()=>setView(true);$('overview').onclick=()=>setView(false);
$('water').onchange=()=>{if(surface)surface.visible=$('water').checked;};
$('reflect').onchange=()=>{surface?.traverse(o=>{if(o.isMesh)o.material=$('reflect').checked?water.material:originalWater;});reflectionDirty=true;};
$('shoe').onchange=()=>{mainViewer.splatMesh.visible=$('shoe').checked;mirrorViewer.splatMesh.visible=$('shoe').checked;reflectionDirty=true;};
$('collider').onchange=()=>{if(collider)collider.visible=$('collider').checked;};
$('level').oninput=()=>{level=Number($('level').value);$('level-value').value=Math.round(level*1000)+' mm';applyLevel();};
$('distortion').oninput=()=>{water.uniforms.waterDistortion.value=Number($('distortion').value);};
$('roughness').oninput=()=>{water.material.roughness=Number($('roughness').value);};
$('save').onclick=()=>{const a=document.createElement('a');a.download=`shoe-sph-${index}.png`;a.href=renderer.domElement.toDataURL('image/png');a.click();};
window.shoeLab={get ready(){return ready;},get frame(){return index;},get report(){return report;},get diagnostics(){return {
  captures,referenceSurfaceHeight,waterHeight:level,sourceGaussians:meta?.render_gaussians,
  mainSorts:mainViewer.lastSortTime,mirrorSorts:mirrorViewer.lastSortTime,
  reflectionSource:'independently sorted mirrored Gaussian shoe',sharedMemory:options.sharedMemoryForWorkers,loading
};},showFrame};
function animate(now){requestAnimationFrame(animate);controls.update();if(!ready)return;
  if(playing&&!loading&&now-last>1000/report.fps){last=now;showFrame((index+1)%report.frame_count);}
  mainViewer.update();mirrorViewer.update();
  // A sort finishes asynchronously; refresh the capture while the viewpoint
  // changes and when a new reflected ordering arrives.
  if(mirrorViewer.sortRunning)reflectionDirty=true;
  captureReflection();mainViewer.render();
}
requestAnimationFrame(animate);
async function start(){
  [meta,report,surfaceMeta]=await Promise.all(['scene.json','playback.json','water-height.json'].map(async url=>{const r=await fetch(url);if(!r.ok)throw Error('尚未生成 '+url);return r.json();}));
  const heightResponse=await fetch('water-height.bin');heights=new Float32Array(await heightResponse.arrayBuffer());
  await mainViewer.addSplatScene('shoe.splat',{showLoadingUI:false,splatAlphaRemovalThreshold:5});
  $('status').textContent='鞋子已载入 · 正在准备独立高斯倒影…';
  await mirrorViewer.addSplatScene('shoe.splat',{showLoadingUI:false,splatAlphaRemovalThreshold:5,scale:[1,-1,1]});
  mirrorScene.add(mirrorViewer.splatMesh);
  const colliderResponse=await fetch('shoe_collision.obj');collider=loader.parse(await colliderResponse.text());
  collider.traverse(o=>{if(o.isMesh)o.material=new THREE.MeshBasicMaterial({color:0xffbf68,wireframe:true,transparent:true,opacity:.18});});collider.visible=false;scene.add(collider);
  // Frame zero has four separate seed blocks. Start after the real solver has
  // filled the seed gaps, while retaining the full timeline for inspection.
  await showFrame(surfaceMeta.reference_frame);ready=true;
  $('status').textContent='已就绪 · 水面与鞋底对齐 · 倒影来自真实高斯';
}
await start();
