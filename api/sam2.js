// api/sam2.js
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

    console.log('Calling Replicate API (Automatic Segmentation)...');

    // 换用 "pablodawson/segment-anything-automatic" 
    // 这是一个专门做全图自动分割的模型，比官方 SAM-2 API 更适合你的需求
    // 它会返回一个包含所有 mask 的数组
    const modelVersion = "103145716d73dc1017eb95373531a2b4700401f28a13270c45343573707355c5";

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
          // 这些参数专门用于控制自动分割的粒度
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
      attempts < 40 
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
      // pablodawson/segment-anything-automatic 的输出通常是一个 JSON 对象数组
      // 每个对象里有 'segmentation' 字段（Mask 的 URL）
      // 我们需要处理一下格式，让前端能用
      
      // 如果 output 直接是数组
      const masks = Array.isArray(prediction.output) ? prediction.output : [];
      
      // 有时候模型返回的是 binary masks 的 URL 列表
      // 有时候是包含详细信息的 JSON
      // 我们把完整结果返给前端，让前端去解析
      
      res.status(200).json({
        success: true,
        masks: masks, 
        originalImage: base64Image,
        rawOutput: prediction.output 
      });
    } else {
      res.status(500).json({ error: 'Failed', details: prediction });
    }

  } catch (err) {
    console.error('API Error:', err);
    res.status(500).json({ error: err.message });
  }
}
