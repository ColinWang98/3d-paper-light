import * as THREE from 'three';

// 全局变量
let scene, camera, renderer;
let headX = 0, headY = 0;

// ================= 1. 初始化 Three.js 场景 =================
function initThreeJS() {
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0.01);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
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

initThreeJS();

// ================= 2. 摄像头头部追踪 =================
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
    .then((stream) => { video.srcObject = stream; })
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

  video.onloadeddata = () => { processFrame(); };
}

// ================= 3. 调用 API 逻辑 (修复解析问题) =================
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
        throw new Error('后端返回无效');
      }

      if (data.success) {
        let maskList = [];
        const masksRaw = data.masks;

        console.log('Frontend received masks:', masksRaw);

        // === 核心修复：强力解析 ===
        
        // 情况 1：它是数组，且第一个元素包含 individual_masks (Replicate SDK 某些版本的怪癖)
        if (Array.isArray(masksRaw) && masksRaw[0] && masksRaw[0].individual_masks) {
          maskList = masksRaw[0].individual_masks;
        }
        // 情况 2：它是个对象，且包含 individual_masks (你这次日志就是这种情况)
        else if (masksRaw && masksRaw.individual_masks) {
          maskList = masksRaw.individual_masks;
        }
        // 情况 3：它本身就是 URL 数组
        else if (Array.isArray(masksRaw)) {
          maskList = masksRaw;
        }
        // 情况 4：它就是个对象（可能只有一个 URL）
        else if (masksRaw) {
           maskList = [masksRaw];
        }

        console.log('Parsed mask list length:', maskList.length);

        if (maskList.length > 0) {
          loadingText.innerText = `识别到 ${maskList.length} 个图层，正在构建 3D 场景...`;
          createSAMLayers(maskList, data.originalImage);
        } else {
          throw new Error('未找到有效图层数据');
        }
      } else {
        throw new Error(data.error || '分割失败');
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
    const width = 512;
    const height = 512;
    
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = width;
    baseCanvas.height = height;
    const baseCtx = baseCanvas.getContext('2d');
    baseCtx.drawImage(originalImg, 0, 0, width, height);
    const originalData = baseCtx.getImageData(0, 0, width, height);

    // 只取前 15 层（你日志里有15层，都展示出来效果更好）
    // 倒序，大的在后
    const validMasks = masks.slice(0, 15).reverse(); 

    validMasks.forEach((maskItem, index) => {
      // 兼容性处理：maskItem 可能是 URL 字符串，也可能是对象
      let maskUrl = '';
      if (typeof maskItem === 'string') maskUrl = maskItem;
      else if (maskItem.segmentation) maskUrl = maskItem.segmentation;
      else if (maskItem.combined_mask) maskUrl = maskItem.combined_mask; // 容错
      
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

        let hasContent = false;
        for (let i = 0; i < maskData.data.length; i += 4) {
          // 判定前景：如果是 URL mask，通常前景是白色(255)或彩色
          // 我们检查 R 通道是否大于 50
          if (maskData.data[i] > 50) { 
            layerData.data[i] = originalData.data[i];     
            layerData.data[i + 1] = originalData.data[i + 1]; 
            layerData.data[i + 2] = originalData.data[i + 2]; 
            layerData.data[i + 3] = 255; 
            hasContent = true;
          } else {
            layerData.data[i + 3] = 0; 
          }
        }

        if (!hasContent) return;

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
        
        // Z轴层叠
        mesh.position.z = index * 0.2; // 稍微紧凑一点
        
        const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 });
        const shadow = new THREE.Mesh(geometry, shadowMat);
        shadow.position.z = mesh.position.z - 0.05;
        shadow.position.x = 0.02;
        shadow.position.y = -0.02;

        scene.add(shadow);
        scene.add(mesh);
      };
    });
  };
}
