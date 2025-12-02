import formidable from 'formidable';
import fs from 'fs';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const form = formidable({});
    
    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve([fields, files]);
      });
    });

    const imageFile = files.image?.[0];
    if (!imageFile) return res.status(400).json({ error: 'No image uploaded' });

    const imageBuffer = await fs.promises.readFile(imageFile.filepath);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = imageFile.mimetype || 'image/jpeg';
    const dataUri = `data:${mimeType};base64,${base64Image}`;

    console.log('Calling Replicate API (Meta SAM-1)...');

    // 使用 Meta 官方维护的 segment-anything (SAM-1)
    // 这是一个绝对公开且支持自动分割的版本 (ViT-Huge)
    // Version created at 2023-06-22, ID: 2b212039...
    const modelVersion = "2b212039fd8d0151a856b54364d55010583985264822892dcc3909116577a713";

    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: modelVersion,
        input: {
          image: dataUri,
          // 关键参数：开启自动分割
          auto_segment: true,
          // 可选参数：调整粒度
          points_per_side: 32,
          pred_iou_thresh: 0.88,
          stability_score_thresh: 0.95,
          min_mask_region_area: 100
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Replicate Error Details:', errorText);
      throw new Error(`Replicate API returned ${response.status}: ${errorText}`);
    }

    let prediction = await response.json();
    console.log('Prediction started:', prediction.id);
    
    let attempts = 0;
    while (
      (prediction.status === 'starting' || prediction.status === 'processing') && 
      attempts < 60 // 增加超时时间，SAM-1 自动分割比较慢
    ) {
      await new Promise(r => setTimeout(r, 2000));
      attempts++;
      const statusRes = await fetch(
        `https://api.replicate.com/v1/predictions/${prediction.id}`,
        {
          headers: { 'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}` }
        }
      );
      prediction = await statusRes.json();
    }

    if (prediction.status === 'succeeded') {
      // Meta 官方 SAM-1 返回的 output 结构通常是：
      // 1. 如果有 masks 字段，那就是 JSON 数组
      // 2. 有时候会返回一个包含 json 文件的 URL
      // 我们这里做个兼容处理，假设它返回的是 JSON 对象数组（标准行为）
      
      console.log('Replicate Output Type:', typeof prediction.output);
      
      res.status(200).json({
        success: true,
        masks: prediction.output, 
        originalImage: base64Image
      });
    } else {
      res.status(500).json({ error: 'Failed', details: prediction });
    }

  } catch (err) {
    console.error('API Error:', err);
    res.status(500).json({ error: err.message });
  }
}
