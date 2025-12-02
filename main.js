import * as THREE from 'three';

// 全局变量
let scene, camera, renderer;
let headX = 0, headY = 0;
let currentOriginalImageBase64 = null; 
let globalLayers = []; 

// 缩放控制变量
let targetZoom = 5; // 目标 Z 轴距离
let currentZoom = 5; // 当前 Z 轴距离

// ================= 1. 初始化 Three.js =================
function initThreeJS() {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.z = currentZoom;

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.getElementById('canvas-container').appendChild(renderer.domElement);
  
  const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(ambientLight);

  // 监听滚轮缩放
  window.addEventListener('wheel', (e) => {
    // 滚轮向下(正) -> 缩小(Z变大)；滚轮向上(负) -> 放大(Z变小)
    targetZoom += e.deltaY * 0.005; 
    // 限制缩放范围 (最近 2，最远 15)
    targetZoom = Math.max(2, Math.min(15, targetZoom));
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  animate();
}

function animate() {
  requestAnimationFrame(animate);

  // 1. 平滑缩放插值
  currentZoom += (targetZoom - currentZoom) * 0.1;
  camera.position.z = currentZoom;

  // 2. 视差效果 (基于当前的 Zoom 调整幅度)
  camera.position.x += (headX * 2 - camera.position.x) * 0.1;
  camera.position.y += (headY * 2 - camera.position.y) * 0.1;
  camera.lookAt(0, 0, 0);

  renderer.render(scene, camera);
}

initThreeJS();

// ================= 2. 摄像头追踪 =================
setTimeout(() => {
  if (window.FaceMesh) initFaceTracking(window.FaceMesh);
  else {
    document.addEventListener('mousemove', (e) => {
      headX = (e.clientX / window.innerWidth - 0.5) * 2;
      headY = -(e.clientY / window.innerHeight - 0.5) * 2;
    });
  }
}, 1000);

function initFaceTracking(FaceMeshClass) {
  const video = document.createElement('video');
  video.autoplay = true; video.playsInline = true; video.style.display = 'none';
  document.body.appendChild(video);

  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
    .then((stream) => { video.srcObject = stream; })
    .catch(e => console.warn("No Camera"));

  const faceMesh = new FaceMeshClass({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
  });
  faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: false });
  faceMesh.onResults((results) => {
    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      const nose = results.multiFaceLandmarks[0][1];
      headX = -(nose.x - 0.5) * 2; headY = (nose.y - 0.5) * 2;
    }
  });

  async function processFrame() {
    if (video.videoWidth > 0) await faceMesh.send({ image: video });
    requestAnimationFrame(processFrame);
  }
  video.onloadeddata = () => processFrame();
}

// ================= 3. 图层管理逻辑 =================
function renderLayerList() {
  const listEl = document.getElementById('layer-list');
  listEl.innerHTML = '';
  
  globalLayers.forEach((layer, index) => {
    const li = document.createElement('li');
    li.className = 'layer-item';
    li.draggable = true;
    li.dataset.index = index;
    const thumbUrl = layer.maskUrl || '';
    
    li.innerHTML = `
      <img src="${thumbUrl}" class="layer-thumb" onerror="this.style.display='none'"/>
      <div class="layer-info">
        图层 ${index + 1} ${layer.isMerged ? '<span class="merged-badge">合并</span>' : ''}
      </div>
    `;

    li.addEventListener('dragstart', handleDragStart);
    li.addEventListener('dragover', handleDragOver);
    li.addEventListener('drop', handleDrop);
    li.addEventListener('dragenter', (e) => li.classList.add('drag-over'));
    li.addEventListener('dragleave', (e) => li.classList.remove('drag-over'));

    listEl.appendChild(li);
  });

  document.getElementById('update3DBtn').style.display = 'block';
}

let draggedIndex = null;
function handleDragStart(e) {
  draggedIndex = parseInt(this.dataset.index);
  e.dataTransfer.effectAllowed = 'move';
  this.classList.add('dragging');
}
function handleDragOver(e) {
  e.preventDefault(); 
  e.dataTransfer.dropEffect = 'move';
  return false;
}
async function handleDrop(e) {
  e.stopPropagation();
  this.classList.remove('drag-over');
  const targetIndex = parseInt(this.dataset.index);
  if (draggedIndex === targetIndex) return;

  const targetLayer = globalLayers[targetIndex];
  const sourceLayer = globalLayers[draggedIndex];
  this.style.opacity = '0.5';
  
  const newMaskUrl = await mergeMaskImages(targetLayer.maskUrl, sourceLayer.maskUrl);
  targetLayer.maskUrl = newMaskUrl;
  targetLayer.isMerged = true;
  globalLayers.splice(draggedIndex, 1);
  renderLayerList();
}

function mergeMaskImages(url1, url2) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const img1 = new Image(); img1.crossOrigin = 'Anonymous';
    const img2 = new Image(); img2.crossOrigin = 'Anonymous';
    
    img1.src = url1;
    img1.onload = () => {
      ctx.drawImage(img1, 0, 0, 512, 512);
      img2.src = url2;
      img2.onload = () => {
        ctx.drawImage(img2, 0, 0, 512, 512);
        resolve(canvas.toDataURL('image/png'));
      };
    };
    img1.onerror = () => resolve(url2);
  });
}

document.getElementById('update3DBtn').addEventListener('click', () => {
  if (!currentOriginalImageBase64) return;
  create3DFromLayers(globalLayers, currentOriginalImageBase64);
});

// ================= 4. API 调用逻辑 =================
const generateBtn = document.getElementById('generateBtn');
generateBtn.addEventListener('click', async () => {
  const fileInput = document.getElementById('fileInput');
  if (fileInput.files.length === 0) return document.getElementById('fileInput').click();

  const loadingEl = document.getElementById('loading');
  loadingEl.style.display = 'flex';
  document.getElementById('loadingText').innerText = 'AI 正在分层...';

  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append('image', file);

  try {
    const res = await fetch('/api/sam2', { method: 'POST', body: formData });
    const data = await res.json();
    
    if (data.success) {
      currentOriginalImageBase64 = data.originalImage;
      let rawMasks = data.masks;
      let finalMasks = [];

      if (Array.isArray(rawMasks) && rawMasks.length === 1 && rawMasks[0].individual_masks) {
        finalMasks = rawMasks[0].individual_masks;
      } else if (rawMasks && rawMasks.individual_masks) {
        finalMasks = rawMasks.individual_masks;
      } else if (Array.isArray(rawMasks)) {
        finalMasks = rawMasks;
      } else if (rawMasks) {
        finalMasks = [rawMasks];
      }

      if (finalMasks.length === 0) throw new Error("未识别到任何图层");
      globalLayers = finalMasks.map((url, i) => ({ id: i, maskUrl: url, isMerged: false }));

      renderLayerList();
      create3DFromLayers(globalLayers, currentOriginalImageBase64);
    } else {
      throw new Error(data.error || 'API Error');
    }
  } catch (e) {
    alert('错误:' + e.message);
  } finally {
    loadingEl.style.display = 'none';
  }
});

document.getElementById('fileInput').addEventListener('change', () => generateBtn.click());

// ================= 5. 3D 生成 (含背光与透明度) =================
function create3DFromLayers(layers, originalBase64) {
  while(scene.children.length > 0) scene.remove(scene.children[0]);
  
  const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(ambientLight);

  // === 新增：背光板 (Light Source) ===
  // 在 Z 轴最深处放置一个发光的暖色平面
  const lightGeo = new THREE.PlaneGeometry(10, 10);
  const lightMat = new THREE.MeshBasicMaterial({ 
    color: 0xFFF4E0, // 暖白光
    side: THREE.DoubleSide 
  });
  const backLight = new THREE.Mesh(lightGeo, lightMat);
  backLight.position.z = -0.5; // 放在所有图层后面
  scene.add(backLight);

  const originalImg = new Image();
  originalImg.src = originalBase64.startsWith('data') ? originalBase64 : `data:image/jpeg;base64,${originalBase64}`;
  
  originalImg.onload = () => {
    const w = 512, h = 512;
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = w; baseCanvas.height = h;
    const baseCtx = baseCanvas.getContext('2d');
    baseCtx.drawImage(originalImg, 0, 0, w, h);
    const originalData = baseCtx.getImageData(0, 0, w, h);

    layers.forEach((layer, index) => {
      const maskImg = new Image();
      maskImg.crossOrigin = 'Anonymous';
      maskImg.src = layer.maskUrl;
      
      maskImg.onload = () => {
        const cvs = document.createElement('canvas');
        cvs.width = w; cvs.height = h;
        const ctx = cvs.getContext('2d');
        
        ctx.drawImage(maskImg, 0, 0, w, h);
        const mData = ctx.getImageData(0, 0, w, h);
        const lData = ctx.createImageData(w, h);
        
        let hasContent = false;
        for(let i=0; i<mData.data.length; i+=4) {
           // 只要是白色区域(前景)
           if(mData.data[i] > 100) {
             lData.data[i] = originalData.data[i];     
             lData.data[i+1] = originalData.data[i+1]; 
             lData.data[i+2] = originalData.data[i+2]; 
             // 关键点：设置 95% 不透明度，让背光能微微透过来
             lData.data[i+3] = 240; 
             hasContent = true;
           } else {
             lData.data[i+3] = 0; 
           }
        }
        
        if(!hasContent) return;
        
        ctx.putImageData(lData, 0, 0);
        const tex = new THREE.CanvasTexture(cvs);
        tex.colorSpace = THREE.SRGBColorSpace;
        
        // 使用 BasicMaterial 保证颜色鲜艳，配合透明度
        const mat = new THREE.MeshBasicMaterial({ 
            map: tex, 
            transparent: true, 
            side: THREE.DoubleSide, 
            opacity: 1.0, // 纹理本身已经带了 alpha=240 的半透明
        });
        
        const geo = new THREE.PlaneGeometry(4, 4);
        const mesh = new THREE.Mesh(geo, mat);
        
        // Z 轴排列：保持前景在前
        mesh.position.z = index * 0.3;
        
        // 阴影层 (黑色半透明)
        const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 });
        const shadow = new THREE.Mesh(geo, shadowMat);
        shadow.position.z = mesh.position.z - 0.05;
        shadow.position.x = 0.03; 
        shadow.position.y = -0.03;
        
        scene.add(shadow);
        scene.add(mesh);
      };
    });
  };
}
