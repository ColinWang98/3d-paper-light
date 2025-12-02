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

    console.log('Calling Replicate API (Official SAM-1)...');

    // 这是 Replicate 官方 Python 客户端默认使用的 SAM-1 (ViT-H) Hash
    // 绝对公开可用
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
          // 这个参数对于自动分割至关重要，必须开启
          auto_segment: true
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
      // SAM-1 auto_segment=true 返回的 output 格式：
      // 它通常是一个 JSON 对象，里面可能包含 "masks" 数组，或者是一个文件 URL
      // 我们直接把整个 output 返回去，让前端打印出来看看结构
      console.log('SAM Output:', JSON.stringify(prediction.output));
      
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
