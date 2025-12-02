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

    console.log('Calling Replicate API (Meta CutLER)...');

    // 使用 Meta CutLER (无监督自动分割)
    // 版本: meta/cutler:4c996f6c...
    const modelVersion = "4c996f6c86e93c35e0d278914f44f32029ee89e6e1a69ed7e71c0a2e86dc8f74";

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
          // 可选参数：置信度阈值 (默认0.15)
          // 如果发现分割太碎，可以调高这个值
          conf_score_thresh: 0.2
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
      attempts < 60
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
      // CutLER 的 output 结构通常包含:
      // - segmentation_masks: Mask 图片的 URL
      // - visualization: 可视化结果
      
      // 我们需要把结果统一一下返给前端
      // 如果 output 本身就是 URL 字符串或者对象，需要打印出来确认结构
      // 根据文档，output 通常是一个包含多个 mask 图片 URL 的数组或对象
      
      console.log('CutLER Output:', JSON.stringify(prediction.output));
      
      // CutLER 有时候返回的是一个包含 JSON 的 URL，有时候是直接的 mask list
      // 我们假设它是标准的 mask list
      const masks = prediction.output.masks || prediction.output; 
      
      res.status(200).json({
        success: true,
        masks: masks, 
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
