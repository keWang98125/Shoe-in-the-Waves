# 鞋边的水：真实 SPH × 高斯鞋子倒影

双击项目根目录的 **启动鞋边水面倒影.cmd**，或在本地服务运行时打开：

http://127.0.0.1:8771/shoe_lab/index.html

默认显示 1 秒时刻，水面与鞋底附近对齐。点击“播放水波”，可观察倒影随 SPH 水面改变；拖动旋转，滚轮缩放。“鞋子倒影”用于对比，“鞋子”会同时隐藏本体和反射源，“水位微调”支持 ±12 mm 的显示调整。不要直接双击 HTML。

所有演示文件和相关依赖现位于 `E:/DeskTop/on`。从此目录启动与复现，不再读取博物馆项目目录；使用本机已安装的 Python 3.10。历史日志保留生成时的原路径，仅作追溯。

## 实际使用的数据

- 原资产：`E:/DeskTop/on/scene.ply`，cloudtilt，Nathan Arditti，249,030 个高斯；原文件未改写。
- 渲染资产：`shoe.splat`，过滤低透明度及离群点后保留 239,040 个高斯。保留各向异性尺度、旋转和 SH0 颜色，未使用完整高阶 SH。
- 显示单位：假设鞋长 0.30 m；这是演示尺度，不是实测标定。
- 动力学：真实 SPlisHSPlasH 2.19.0 / DFSPH，11,544 个粒子，4 秒、12 fps、49 帧；原始粒子、重建 OBJ 和参数在 `run/`。
- 碰撞：扫描点构成的静态封闭凸包，底部延伸至水槽底部，避免水从代理下面穿入。它只用于碰撞，可勾选查看；没有用它渲染鞋子倒影。鞋子不漂浮、不变形，不模拟鞋底孔洞内进水、吸水和润湿。
- 初始水体从四个避开鞋子包围盒的块开始，求解器将其铺开。默认从第 12 帧开始显示；开头几帧属于启动过渡，不是已经达到平衡的静水。

资产来源及署名：[cloudtilt / Nathan Arditti](https://superspl.at/scene/5c872c69)，CC BY 4.0。原署名另存于 `license.txt`。

## 反射如何实现

主视图与倒影视图分别加载同一份高斯鞋子，拥有独立的排序实例。倒影实例相对水平水面做 Y 方向镜像，其位置、协方差和深度排序均参与高斯渲染，输出到线性半浮点纹理。主视图使用独立的正常鞋子实例。

水面沿用 `../local_lab/water-reflection.mjs` 的着色器：根据当前水面法线扰动反射采样位置，再按空气/水的菲涅耳系数及粗糙度混合颜色。没有用一张静态鞋子照片充当倒影，也没有用鞋子的网格代理代替高斯反射源。

## 水面重建与对齐的准确范围

`pack_surface.py` 从每帧真实 splashsurf OBJ 的向上表面采样上包络，以约 8 mm 空间滤波降低粒子尺度的重建噪声，并保持该帧原始向上表面的面积加权平均高度。它只处理显示表面，没有用正弦动画替代 SPH 动力学。浏览器回放的是这些采样高度和由其计算的法线。

为了放到鞋底附近，所有水面帧统一上移约 **2.09 mm**，将第 12 帧的平均水面置于鞋底基准 0；每帧自身的波动与水位变化保留。这个偏移是显示对齐，未重新求解对应的接触位置，不能当成毫米级接触精度验证。物理粒子半径为 5 mm，鞋底本身也使用近似凸包。

连续显示表面是单值高度场：省略分离水滴、翻卷和水面下表面，鞋子内部被遮住的高度采用插值。倒影仍使用水平面镜像加法线扰动，适合本演示的小波浪；没有实现逐点反射光线追踪、真实折射、焦散、接触阴影或完整场景重新照明。

`run_aligned/` 保留了调试期间增加初始水量的一次独立试验，最终入口使用的是 `run/`，没有混用其参数和表面。

## 已执行的检查

运行项目根目录的 `node shoe_lab/check.mjs`，可重复浏览器检查。`validation.json` 记录：

- 第 12 帧和第 28 帧分别开关倒影后，水面区域均发生明显像素变化。
- 隐藏真实高斯鞋子后，水面中的鞋子反射同步消失。
- 两个模拟时刻的水面和倒影不同。
- 播放、干湿切换、水位微调及视角切换正常，没有捕获到页面或 WebGL 错误。
- 49 帧记录的水量一致。此项证明数据水量守恒，不等于已经验证物理精度。

截图：`shoe-water.png`、`shoe-water-waves.png`、`shoe-no-reflection.png`、`viewer-preview.png`。实际画布录制：`shoe-water-demo.webm`。

## 复现

在项目根目录执行。使用已有 Python 3.10 和项目依赖，不修改全局 Python。`run_python.py` 先加载基础 DLL，再引入项目依赖，以兼容本机的原生模块路径。

```powershell
& E:/python3.10/python.exe shoe_lab/run_python.py shoe_lab/prepare.py
# 新模拟应写入新的目录，保留已完成的 run。
& E:/python3.10/python.exe shoe_lab/run_python.py local_lab/simulate.py shoe_lab/sph_scene.json shoe_lab/run_new --duration 4 --fps 12 --surface
# pack_surface.py 默认读取已交付的 run；切换新实验时显式修改它和查看器的输入路径。
& E:/python3.10/python.exe shoe_lab/run_python.py shoe_lab/pack_surface.py
node shoe_lab/check.mjs
```

实现依据现有 Three.js / GaussianSplats3D 与项目 SPH 工具，没有声称复现 Gaussian Splashing 的完整训练或仿真框架。
