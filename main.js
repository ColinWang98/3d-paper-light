import * as THREE from 'three';

// 全局变量
let scene, camera, renderer;
let headX = 0, headY = 0;

// ================= 1. 初始化 Three.js 场景 =================
function initThreeJS() {
  scene = new THREE.Scene();
  // 黑色背景 + 雾气，增加深邃感
  scene.fog = new THREE.FogExp2(0x000000, 0.01);

  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.z = 5;

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('canvas-container').appendChild(renderer.domElement);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(5, 5, 5);
  scene.add(dirLight);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  animate();
}

function animate() {
  requestAnimationFrame(animate);

  // 头部控制相机 (带平滑效果)
  camera.position.x += (headX * 2 - camera.position.x) * 0.1;
  camera.position.y += (headY * 2 - camera.position.y) * 0.1;
  camera.lookAt(0, 0, 0);

  renderer.render(scene, camera);
}

// 启动 Three.js
initThreeJS();

// ================= 2. 摄像头头部追踪 (CDN 引入修复版) =================
function waitForFaceMesh() {
  if (window.FaceMesh) {
    initFaceTracking(window.FaceMesh);
  } else {
    // 每 500ms 检查一次 FaceMesh 是否加载完成
    setTimeout(waitForFaceMesh, 500);
  }
}
waitForFaceMesh();

function initFaceTracking(FaceMeshClass) {
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.style.display = 'none';
  document.body.appendChild(video);

  navigator.mediaDevices
    .getUserMedia({ video: { facingMode: 'user' } })
    .then((stream) => {
      video.srcObject = stream;
    })
    .catch((err) => {
      console.warn('无法访问摄像头，降级为鼠标控制');
      // 降级方案：如果没有摄像头，用鼠标控制视差
      document.addEventListener('mousemove', (e) => {
        headX = (e.clientX / window.innerWidth - 0.5) * 2;
        headY = -(e.clientY / window.innerHeight - 0.5) * 2;
      });
    });

  const faceMesh = new FaceMeshClass({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
  });

  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: false,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  faceMesh.onResults((results) => {
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) return;
    const landmarks = results.multiFaceLandmarks[0];
    const nose = landmarks[1];
    // 映射坐标：左右镜像修正
    headX = -(nose.x - 0.5) * 2; 
    headY = (nose.y - 0.5) * 2;  
  });

  async function processFrame() {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      await faceMesh.send({ image: video });
    }
    requestAnimationFrame(processFrame);
  }

  video.onloadeddata = () => {
    processFrame();
  };
}

// ================= 3. 调用 API 逻辑 (核心修复) =================
const generateBtn = document.getElementById('generateBtn');

if (generateBtn) {
  generateBtn.addEventListener('click', async () => {
    const fileInput = document.getElementById('fileInput');
    if (fileInput.files.length === 0) return alert('请先选择一张照片');

    const loadingEl = document.getElementById('loading');
    const loadingText = document.getElementById('loadingText');
    loadingEl.style.display = 'block';
    loadingText.innerText = '正在上传并调用 AI 分割...';

    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('image', file);

    try {
      const response = await fetch('/api/sam2', {
        method: 'POST',
        body: formData
      });

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.error('Raw Response:', text);
        throw new Error('后端返回无效，请查看控制台日志');
      }

      if (data.success && data.masks) {
        // === 关键修复：适配 SAM-2 SDK 的返回结构 ===
        let maskList = [];
        
        // 情况 1: individual_masks 存在 (Replicate SDK 常见返回)
        if (data.masks.individual_masks && Array.isArray(data.masks.individual_masks)) {
          maskList = data.masks.individual_masks;
        } 
        // 情况 2: data.masks 本身就是数组
        else if (Array.isArray(data.masks)) {
          maskList = data.masks;
        }
        // 情况 3: 单个对象，强制转数组
        else {
           maskList = [data.masks];
        }

        if (maskList.length > 0) {
          loadingText.innerText = `识别到 ${maskList.length} 个图层，正在构建 3D 场景...`;
          createSAMLayers(maskList, data.originalImage);
        } else {
          throw new Error('未找到有效图层数据');
        }
      } else {
        throw new Error(data.error || '分割失败，未返回有效 mask');
      }
    } catch (error) {
      console.error('SAM-2 Error:', error);
      alert('分割失败: ' + error.message);
    } finally {
      setTimeout(() => {
        loadingEl.style.display = 'none';
      }, 1000);
    }
  });
}

// ================= 4. 根据 SAM 结果生成图层 =================
function createSAMLayers(masks, originalImageBase64) {
  // 清空旧场景
  while (scene.children.length > 0) scene.remove(scene.children[0]);

  // 重新添加灯光
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(5, 5, 5);
  scene.add(dirLight);

  // 加载原图
  const originalImg = new Image();
  // 兼容 base64 前缀
  if (!originalImageBase64.startsWith('data:image')) {
     originalImg.src = `data:image/jpeg;base64,${originalImageBase64}`;
  } else {
     originalImg.src = originalImageBase64;
  }
  
  originalImg.onload = () => {
    const width = 512; // 限制纹理尺寸，防止显存爆炸
    const height = 512;
    
    // 创建原图的 Canvas 上下文
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = width;
    baseCanvas.height = height;
    const baseCtx = baseCanvas.getContext('2d');
    baseCtx.drawImage(originalImg, 0, 0, width, height);
    const originalData = baseCtx.getImageData(0, 0, width, height);

    // 倒序遍历图层 (让背景在后，前景在前)
    // 通常 SAM 返回的 masks 顺序不一定，但我们先假设它按面积排序
    // 或者直接按原顺序堆叠
    const validMasks = masks.slice(0, 8).reverse(); 

    validMasks.forEach((maskItem, index) => {
      // 获取 Mask URL (兼容 string 或 object)
      const maskUrl = typeof maskItem === 'string' ? maskItem : maskItem.segmentation;
      if (!maskUrl) return;

      const maskImg = new Image();
      maskImg.crossOrigin = "Anonymous"; // 必须加，否则无法读取像素
      maskImg.src = maskUrl;

      maskImg.onload = () => {
        const layerCanvas = document.createElement('canvas');
        layerCanvas.width = width;
        layerCanvas.height = height;
        const layerCtx = layerCanvas.getContext('2d');
        
        // 1. 绘制 Mask
        layerCtx.drawImage(maskImg, 0, 0, width, height);
        
        const maskData = layerCtx.getImageData(0, 0, width, height);
        const layerData = layerCtx.createImageData(width, height);

        // 2. 像素处理：利用 Mask 抠出原图
        let hasContent = false;
        for (let i = 0; i < maskData.data.length; i += 4) {
          // 如果 Mask 像素比较亮 (白色)，说明是前景
          if (maskData.data[i] > 100) { 
            layerData.data[i] = originalData.data[i];     // R
            layerData.data[i + 1] = originalData.data[i + 1]; // G
            layerData.data[i + 2] = originalData.data[i + 2]; // B
            layerData.data[i + 3] = 255; // 不透明
            hasContent = true;
          } else {
            layerData.data[i + 3] = 0; // 透明
          }
        }

        // 如果这一层全是透明的，跳过
        if (!hasContent) return;

        layerCtx.putImageData(layerData, 0, 0);

        // 3. 创建 Three.js 材质
        const texture = new THREE.CanvasTexture(layerCanvas);
        texture.colorSpace = THREE.SRGBColorSpace;

        const material = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          side: THREE.DoubleSide,
          alphaTest: 0.1, // 去除边缘锯齿
        });

        // 4. 创建 3D 平面
        const geometry = new THREE.PlaneGeometry(4, 4);
        const mesh = new THREE.Mesh(geometry, material);
        
        // Z轴排列：index 越大越靠前
        mesh.position.z = index * 0.5; 
        
        // 5. 添加黑色投影层 (模拟纸雕阴影)
        const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 });
        const shadow = new THREE.Mesh(geometry, shadowMat);
        shadow.position.z = mesh.position.z - 0.1;
        shadow.position.x = 0.05;
        shadow.position.y = -0.05;

        scene.add(shadow);
        scene.add(mesh);
      };
    });
  };
}
