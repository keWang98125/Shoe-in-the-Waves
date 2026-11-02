import * as THREE from 'three';
import {Reflector} from 'three/addons/objects/Reflector.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

// The helper plane only captures the scene. Visible geometry always remains
// the reconstructed SPH surface; no animated plane replaces the simulation.
export class WaterReflection {
  constructor(renderer, scene) {
    this.renderer=renderer; this.scene=scene; this.height=.2; this.scale=1;
    this.captureCount=0;
    this.dirty=true;this.lastCamera=new THREE.Matrix4();this.lastProjection=new THREE.Matrix4();
    this.mirror=new Reflector(new THREE.PlaneGeometry(1,1),{
      textureWidth:768,textureHeight:768,multisample:0,clipBias:.001
    });
    this.mirror.rotation.x=-Math.PI/2;
    this.uniforms={
      waterReflection:{value:this.mirror.getRenderTarget().texture},
      waterProjection:{value:new THREE.Matrix4()},
      waterHeight:{value:this.height}, waterScale:{value:1},
      waterDistortion:{value:.12}, waterNormalView:{value:0},
      waterCaptureValid:{value:0},
      waterTexel:{value:new THREE.Vector2(1/768,1/768)}
    };
    const pmrem=new THREE.PMREMGenerator(renderer), room=new RoomEnvironment();
    this.environment=pmrem.fromScene(room,.04);scene.environment=this.environment.texture;
    room.dispose();pmrem.dispose();
    this.material=new THREE.MeshPhysicalMaterial({
      color:0x18434b,roughness:.09,metalness:0,ior:1.333,
      side:THREE.DoubleSide,transparent:true,opacity:.94,depthWrite:true
    });
    this.material.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,this.uniforms);
      shader.vertexShader='varying vec3 waterWorldPosition;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',
        '#include <project_vertex>\nwaterWorldPosition=(modelMatrix*vec4(transformed,1.0)).xyz;');
      shader.fragmentShader=`
        uniform sampler2D waterReflection;
        uniform mat4 waterProjection;
        uniform float waterHeight,waterScale,waterDistortion,waterNormalView,waterCaptureValid;
        uniform vec2 waterTexel;
        varying vec3 waterWorldPosition;
      `+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
        vec3 waterN=normalize(inverseTransformDirection(normal,viewMatrix));
        vec3 waterV=normalize(cameraPosition-waterWorldPosition);
        // Schlick approximation for air/water, F0=((1-1.333)/(1+1.333))^2.
        float waterF=.02037+.97963*pow(1.0-clamp(dot(waterN,waterV),0.0,1.0),5.0);
        vec3 samplePosition=waterWorldPosition;
        samplePosition.y=waterHeight;
        samplePosition.xz+=waterN.xz*waterDistortion*waterScale;
        vec4 projected=waterProjection*vec4(samplePosition,1.0);
        vec2 uv=projected.xy/max(projected.w,.0001);
        float edge=smoothstep(0.0,.04,min(min(uv.x,uv.y),min(1.0-uv.x,1.0-uv.y)));
        // A mean-plane capture is unreliable on vertical sheets and splashes.
        float confidence=waterCaptureValid*edge*step(0.0,projected.w)*smoothstep(.35,.85,waterN.y)
          *exp(-abs(waterWorldPosition.y-waterHeight)/max(.22*waterScale,.01));
        vec2 blur=waterTexel*roughness*12.0;
        vec3 capture=texture2D(waterReflection,uv).rgb*.4;
        capture+=(texture2D(waterReflection,uv+vec2(blur.x,0.0)).rgb
          +texture2D(waterReflection,uv-vec2(blur.x,0.0)).rgb
          +texture2D(waterReflection,uv+vec2(0.0,blur.y)).rgb
          +texture2D(waterReflection,uv-vec2(0.0,blur.y)).rgb)*.15;
        vec3 planarLight=totalDiffuse*(1.0-waterF)+reflectedLight.directSpecular+capture*waterF;
        outgoingLight=mix(outgoingLight,planarLight,confidence);
        if(waterNormalView>.5) outgoingLight=waterN*.5+.5;
        #include <opaque_fragment>
      `);
    };
  }
  // Area-weighted horizontal-surface height: bounds would follow the highest
  // splash; vertex averages would over-weight the finely triangulated walls.
  fit(surface,scale) {
    this.scale=scale;let sum=0,weight=0;
    if(surface.userData.reflectionHeight!==undefined){
      this.height=surface.userData.reflectionHeight;
      this.uniforms.waterHeight.value=this.height;this.uniforms.waterScale.value=scale;return;
    }
    surface.updateMatrixWorld(true);
    const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
    const ab=new THREE.Vector3(),ac=new THREE.Vector3(),cross=new THREE.Vector3();
    surface.traverse(mesh=>{
      if(!mesh.isMesh)return;
      const p=mesh.geometry.attributes.position,ix=mesh.geometry.index;
      for(let i=0;i<(ix?ix.count:p.count);i+=3){
        a.fromBufferAttribute(p,ix?ix.getX(i):i).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(p,ix?ix.getX(i+1):i+1).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(p,ix?ix.getX(i+2):i+2).applyMatrix4(mesh.matrixWorld);
        cross.crossVectors(ab.subVectors(b,a),ac.subVectors(c,a));
        if(cross.y>cross.length()*.7){sum+=(a.y+b.y+c.y)/3*cross.y;weight+=cross.y;}
      }
    });
    if(weight>0)this.height=sum/weight;
    surface.userData.reflectionHeight=this.height;
    this.uniforms.waterHeight.value=this.height;
    this.uniforms.waterScale.value=scale;
  }
  capture(camera,surface,proxyObjects=[],splatMesh=null) {
    this.uniforms.waterCaptureValid.value=0;
    if(!surface||camera.position.y<=this.height)return;
    this.scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);
    if(!this.dirty&&this.lastSurface===surface&&this.lastSplat===splatMesh
      &&this.lastCamera.equals(camera.matrixWorld)&&this.lastProjection.equals(camera.projectionMatrix)){
      this.uniforms.waterCaptureValid.value=1;return;
    }
    this.mirror.position.y=this.height;this.mirror.updateMatrixWorld(true);
    const states=proxyObjects.map(o=>[o,o.visible]);
    const splatVisible=splatMesh?.visible;
    const surfaceVisible=surface.visible;
    try{
      surface.visible=false;
      // GaussianSplats3D sorts for the main camera. Until a second sorter is
      // available, the reflected car uses the aligned physical mesh proxy.
      if(splatMesh){splatMesh.visible=false;for(const [o] of states)o.visible=true;}
      this.mirror.onBeforeRender(this.renderer,this.scene,camera);
      this.uniforms.waterProjection.value.copy(this.mirror.material.uniforms.textureMatrix.value)
        .multiply(new THREE.Matrix4().copy(this.mirror.matrixWorld).invert());
      this.captureCount++;
      this.uniforms.waterCaptureValid.value=1;
      this.lastCamera.copy(camera.matrixWorld);this.lastProjection.copy(camera.projectionMatrix);
      this.lastSurface=surface;this.lastSplat=splatMesh;this.dirty=false;
    }finally{
      surface.visible=surfaceVisible;
      if(splatMesh)splatMesh.visible=splatVisible;
      for(const [o,visible] of states)o.visible=visible;
    }
  }
  resize(width,height){
    this.dirty=true;
    const factor=Math.min(1,1024/Math.max(width,height));
    const w=Math.max(1,Math.round(width*factor)),h=Math.max(1,Math.round(height*factor));
    this.mirror.getRenderTarget().setSize(w,h);this.uniforms.waterTexel.value.set(1/w,1/h);
  }
}
