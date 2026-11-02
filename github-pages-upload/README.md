# 鞋边的水：静态网站发布版

此文件夹可直接发布到 GitHub Pages，无需 Python、Node 服务或特殊响应头。
将本文件夹里的全部内容上传到仓库根目录，然后在 Settings → Pages 选择 Deploy from a branch，分支 main，目录 / (root)。
若上传的是整个开发项目，则选择 main 的 /docs 目录。
保存并等待发布完成，访问 GitHub 给出的网站链接；仓库中的 HTML 文件预览不会运行三维程序。

请保留 vendor 下的许可证和 .nojekyll。鞋子资产 cloudtilt，Nathan Arditti，CC BY 4.0。
水面是已计算的真实 SPH 回放，倒影由独立排序的镜像高斯生成；没有声称在线运行 SPH 求解器。
