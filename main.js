import * as THREE from 'three';

// 全局变量
let scene, camera, renderer;
let headX = 0, headY = 0;

// ================= 1. 初始化 Three.js 场景 =================
function initThreeJS() {
  scene = new THREE.Scene();
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

// ================= 3. 调用 API 逻辑 =================
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
        throw new Error('后端返回无效，请查看 Vercel Logs');
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
    } finally {
      setTimeout(() => {
        loadingEl.style.display = 'none';
      }, 1000);
    }
  });
}

// ================= 4. 根据 SAM 结果生成图层 =================
function createSAMLayers(masks, originalImageBase64) {
  while (scene.children.length > 0) scene.remove(scene.children[0]);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(5, 5, 5);
  scene.add(dirLight);

  const originalImg = new Image();
  if (!originalImageBase64.startsWith('data:image')) {
     originalImg.src = `data:image/jpeg;base64,${originalImageBase64}`;
  } else {
     originalImg.src = originalImageBase64;
  }
  
  originalImg.onload = () => {
    const width = originalImg.width;
    const height = originalImg.height;
    
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = width;
    baseCanvas.height = height;
    const baseCtx = baseCanvas.getContext('2d');
    baseCtx.drawImage(originalImg, 0, 0, width, height);
    const originalData = baseCtx.getImageData(0, 0, width, height);

    const validMasks = masks.slice(0, 8); // 最多 8 层

    validMasks.forEach((maskItem, index) => {
      const maskUrl = typeof maskItem === 'string' ? maskItem : maskItem.segmentation;
      if (!maskUrl) return;

      const maskImg = new Image();
      maskImg.crossOrigin = "Anonymous";
      maskImg.src = maskUrl;

      maskImg.onload = () => {
        const layerCanvas = document.createElement('canvas');
        layerCanvas.width = width;
        layerCanvas.height = height;
        const layerCtx = layerCanvas.getContext('2d');
        
        layerCtx.drawImage(maskImg, 0, 0, width, height);
        
        const maskData = layerCtx.getImageData(0, 0, width, height);
        const layerData = layerCtx.createImageData(width, height);

        for (let i = 0; i < maskData.data.length; i += 4) {
          if (maskData.data[i] > 128) { // 白色区域
            layerData.data[i] = originalData.data[i];     
            layerData.data[i + 1] = originalData.data[i + 1]; 
            layerData.data[i + 2] = originalData.data[i + 2]; 
            layerData.data[i + 3] = 255; 
          } else {
            layerData.data[i + 3] = 0; 
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

        const aspect = width / height;
        const geometry = new THREE.PlaneGeometry(4 * aspect, 4);
        const mesh = new THREE.Mesh(geometry, material);
        
        mesh.position.z = index * 0.5; 
        
        const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 });
        const shadow = new THREE.Mesh(geometry, shadowMat);
        shadow.position.z = mesh.position.z - 0.1;

        scene.add(shadow);
        scene.add(mesh);
      };
    });
  };
}
