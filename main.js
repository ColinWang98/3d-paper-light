import * as THREE from 'three';
import { FaceMesh } from '@mediapipe/face_mesh';

// 全局变量
let scene, camera, renderer;
let headX = 0, headY = 0;

// ================= 1. 初始化 Three.js 场景 =================
function initThreeJS() {
  scene = new THREE.Scene();
  // 黑色背景 + 雾气
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

// ================= 2. 摄像头头部追踪 =================
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
    console.error('摄像头权限获取失败:', err);
  });

const faceMesh = new FaceMesh({
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
  headX = -(nose.x - 0.5) * 2; // 左右镜像修正
  headY = (nose.y - 0.5) * 2;  // 上下正常
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

// ================= 3. 调用 SAM-2 API 逻辑 =================
const generateBtn = document.getElementById('generateBtn');

generateBtn.addEventListener('click', async () => {
  const fileInput = document.getElementById('fileInput');
  if (fileInput.files.length === 0) return alert('请先选择一张照片');

  const loadingEl = document.getElementById('loading');
  const loadingText = document.getElementById('loadingText');
  loadingEl.style.display = 'block';
  loadingText.innerText = '正在上传并调用 SAM-2 AI 分割...';

  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append('image', file);

  try {
    // 发送请求
    const response = await fetch('/api/sam2', {
      method: 'POST',
      body: formData
    });

    // 调试用：先看文本内容，防止 JSON 解析失败
    const text = await response.text();
    console.log('Server Response:', text); 

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('后端返回的不是合法 JSON，请查看控制台');
    }

    if (data.success && data.masks && data.masks.length > 0) {
      loadingText.innerText = '正在生成 3D 纸雕模型...';
      createSAMLayers(data.masks, data.originalImage);
    } else {
      throw new Error(data.error || '分割失败，未返回有效 mask');
    }
  } catch (error) {
    console.error('SAM-2 Error:', error);
    alert('分割失败: ' + error.message);
    loadingText.innerText = '出错，请重试';
  } finally {
    setTimeout(() => {
      loadingEl.style.display = 'none';
    }, 2000);
  }
});

// ================= 4. 根据 SAM 结果生成图层 =================
function createSAMLayers(masks, originalImageBase64) {
  // 清空旧场景
  while (scene.children.length > 0) scene.remove(scene.children[0]);

  // 重新加灯光
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(5, 5, 5);
  scene.add(dirLight);

  // 辅助 Canvas
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // 加载原图
  const originalImg = new Image();
  // 确保 base64 格式正确
  if (!originalImageBase64.startsWith('data:image')) {
     originalImg.src = `data:image/jpeg;base64,${originalImageBase64}`;
  } else {
     originalImg.src = originalImageBase64;
  }
  
  originalImg.onload = () => {
    ctx.drawImage(originalImg, 0, 0, 512, 512);
    const originalData = ctx.getImageData(0, 0, 512, 512);

    // 倒序遍历
    masks.forEach((mask, index) => {
      const layerCanvas = document.createElement('canvas');
      layerCanvas.width = 512;
      layerCanvas.height = 512;
      const layerCtx = layerCanvas.getContext('2d');
      const layerData = layerCtx.createImageData(512, 512);

      for (let i = 0; i < mask.length; i++) {
        const pixelIndex = i * 4;
        if (mask[i] > 0) { // 是前景
          layerData.data[pixelIndex] = originalData.data[pixelIndex];     // R
          layerData.data[pixelIndex + 1] = originalData.data[pixelIndex + 1]; // G
          layerData.data[pixelIndex + 2] = originalData.data[pixelIndex + 2]; // B
          layerData.data[pixelIndex + 3] = 255; // Alpha
        } else {
          layerData.data[pixelIndex + 3] = 0; // 透明
        }
      }

      layerCtx.putImageData(layerData, 0, 0);

      const texture = new THREE.CanvasTexture(layerCanvas);
      texture.colorSpace = THREE.SRGBColorSpace;

      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide,
        alphaTest: 0.1, 
      });

      const geometry = new THREE.PlaneGeometry(4, 4);
      const mesh = new THREE.Mesh(geometry, material);
      
      // Z轴排列
      mesh.position.z = index * 0.5; 
      
      // 阴影
      const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 });
      const shadow = new THREE.Mesh(geometry, shadowMat);
      shadow.position.z = mesh.position.z - 0.1;
      shadow.position.x = 0.05;
      shadow.position.y = -0.05;

      scene.add(shadow);
      scene.add(mesh);
    });
  };
}
