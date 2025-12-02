import * as THREE from 'three';

// 全局变量
let scene, camera, renderer;
let headX = 0, headY = 0;
let currentOriginalImageBase64 = null; // 保存原图
let globalLayers = []; // 存储当前的图层数据 [{id: 0, maskUrl: '...', combined: false}, ...]

// ================= 1. 初始化 Three.js =================
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

// ================= 2. 摄像头追踪 =================
// ... (保留你之前的 FaceMesh 代码，或者直接用我之前给的稳定版) ...
// 为节省篇幅，假设这里已有 initFaceTracking
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
    // ... (你的标准摄像头代码) ...
    // 如果没有，请把之前完整版 main.js 里的这部分拷过来
    // 或者回复“需要完整摄像头代码”
}

// ================= 3. 图层管理逻辑 (核心新增) =================

// 渲染图层列表到左侧面板
function renderLayerList() {
  const listEl = document.getElementById('layer-list');
  listEl.innerHTML = '';
  
  globalLayers.forEach((layer, index) => {
    const li = document.createElement('li');
    li.className = 'layer-item';
    li.draggable = true;
    li.dataset.index = index;
    
    li.innerHTML = `
      <img src="${layer.maskUrl}" class="layer-thumb" />
      <div class="layer-info">
        图层 ${index + 1} ${layer.isMerged ? '(已合并)' : ''}
      </div>
    `;

    // 拖拽事件
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
  e.preventDefault(); // 必须调用，否则无法 drop
  e.dataTransfer.dropEffect = 'move';
  return false;
}

async function handleDrop(e) {
  e.stopPropagation();
  this.classList.remove('drag-over');
  
  const targetIndex = parseInt(this.dataset.index);
  if (draggedIndex === targetIndex) return;

  // 执行合并：把 draggedLayer 合并到 targetLayer
  const targetLayer = globalLayers[targetIndex];
  const sourceLayer = globalLayers[draggedIndex];

  // 合并逻辑：Canvas 叠加
  const newMaskUrl = await mergeMaskImages(targetLayer.maskUrl, sourceLayer.maskUrl);
  
  // 更新数据
  targetLayer.maskUrl = newMaskUrl;
  targetLayer.isMerged = true;
  
  // 删除源图层
  globalLayers.splice(draggedIndex, 1);
  
  // 重新渲染列表
  renderLayerList();
}

// 辅助：合并两张 Mask 图片
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
        // 混合模式：叠加 (Lighten or Source-Over)
        ctx.globalCompositeOperation = 'source-over'; // 简单覆盖或叠加
        ctx.drawImage(img2, 0, 0, 512, 512);
        resolve(canvas.toDataURL('image/png'));
      };
    };
  });
}

// 点击“更新 3D 场景”按钮
document.getElementById('update3DBtn').addEventListener('click', () => {
  if (!currentOriginalImageBase64) return;
  create3DFromLayers(globalLayers, currentOriginalImageBase64);
});

// ================= 4. API 调用与初始化 =================
const generateBtn = document.getElementById('generateBtn');
generateBtn.addEventListener('click', async () => {
  const fileInput = document.getElementById('fileInput');
  if (fileInput.files.length === 0) return document.getElementById('fileInput').click();

  const loadingEl = document.getElementById('loading');
  loadingEl.style.display = 'block';
  document.getElementById('loadingText').innerText = 'AI 正在分层...';

  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append('image', file);

  try {
    const res = await fetch('/api/sam2', { method: 'POST', body: formData });
    const data = await res.json();
    
    if (data.success) {
      currentOriginalImageBase64 = data.originalImage;
      
      // 解析 masks
      let masks = [];
      if (data.masks && data.masks.individual_masks) masks = data.masks.individual_masks;
      else if (Array.isArray(data.masks)) masks = data.masks;
      else masks = [data.masks];

      // 初始化全局图层列表
      // ⚠️ 注意：这里不做 reverse，按原始顺序放入列表，让用户自己拖
      globalLayers = masks.slice(0, 10).map((url, i) => ({
        id: i,
        maskUrl: url,
        isMerged: false
      }));

      renderLayerList(); // 显示列表
      create3DFromLayers(globalLayers, currentOriginalImageBase64); // 初始 3D
    }
  } catch (e) {
    alert('失败:' + e.message);
  } finally {
    loadingEl.style.display = 'none';
  }
});

// 监听文件选择
document.getElementById('fileInput').addEventListener('change', () => generateBtn.click());


// ================= 5. 3D 生成逻辑 =================
function create3DFromLayers(layers, originalBase64) {
  while(scene.children.length > 0) scene.remove(scene.children[0]);
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(5, 5, 5);
  scene.add(dirLight);

  const originalImg = new Image();
  originalImg.src = originalBase64.startsWith('data') ? originalBase64 : `data:image/jpeg;base64,${originalBase64}`;
  
  originalImg.onload = () => {
    const w = 512, h = 512;
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = w; baseCanvas.height = h;
    const baseCtx = baseCanvas.getContext('2d');
    baseCtx.drawImage(originalImg, 0, 0, w, h);
    const originalData = baseCtx.getImageData(0, 0, w, h);

    // ⚠️ 这里的渲染顺序决定前后
    // 如果你觉得背景在前，就把这里的 layers.reverse() 或者去掉 reverse()
    // 假设列表第一个是背景(最远)，最后一个是前景(最近)
    const renderList = [...layers]; // 复制一份
    // renderList.reverse(); // 如果需要反转

    renderList.forEach((layer, index) => {
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
           if(mData.data[i] > 50) {
             lData.data[i] = originalData.data[i];
             lData.data[i+1] = originalData.data[i+1];
             lData.data[i+2] = originalData.data[i+2];
             lData.data[i+3] = 255;
             hasContent = true;
           } else {
             lData.data[i+3] = 0;
           }
        }
        if(!hasContent) return;
        ctx.putImageData(lData, 0, 0);
        
        const tex = new THREE.CanvasTexture(cvs);
        tex.colorSpace = THREE.SRGBColorSpace;
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, alphaTest: 0.1 });
        const geo = new THREE.PlaneGeometry(4, 4);
        const mesh = new THREE.Mesh(geo, mat);
        
        // Z 轴间隔
        mesh.position.z = index * 0.4;
        
        // 阴影
        const shadowMat = new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.3 });
        const shadow = new THREE.Mesh(geo, shadowMat);
        shadow.position.z = mesh.position.z - 0.1;
        shadow.position.x = 0.05; shadow.position.y = -0.05;
        
        scene.add(shadow);
        scene.add(mesh);
      };
    });
  };
}
