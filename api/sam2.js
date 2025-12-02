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

    // 使用 pablodawson/segment-anything-automatic (基于 SAM-1 的自动全图分割)
    // 这是一个长期稳定的版本 hash
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
          // 这里的参数不需要太复杂，默认即可
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Replicate Error Details:', errorText);
      throw new Error(`Replicate API returned ${response.status}: ${errorText}`);
    }

    let prediction = await response.json();
    
    // 轮询
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
      // 这个模型返回的 output 就是一个包含 mask URL 的 JSON 对象数组
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
