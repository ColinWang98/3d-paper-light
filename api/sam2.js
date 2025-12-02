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

    console.log('Calling Replicate API...');

    // 使用原生 fetch（Node 18+ 自带，Vercel 默认就是 Node 18+）
    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: '810c082307a6736d9642c8b26b5659167f04ff0e383823b8c7df717e5499241c',
        input: {
          image: `data:${mimeType};base64,${base64Image}`,
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Replicate API returned ${response.status}`);
    }

    let prediction = await response.json();
    console.log('Initial prediction status:', prediction.status);

    // 轮询结果
    let attempts = 0;
    while (
      (prediction.status === 'starting' || prediction.status === 'processing') && 
      attempts < 30
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
      console.log(`Attempt ${attempts}, status: ${prediction.status}`);
    }

    if (prediction.status === 'succeeded') {
      res.status(200).json({
        success: true,
        masks: prediction.output, 
        originalImage: base64Image
      });
    } else {
      res.status(500).json({ 
        error: 'Replicate processing failed or timed out', 
        details: prediction 
      });
    }

  } catch (err) {
    console.error('API Error:', err);
    res.status(500).json({ error: err.message });
  }
}
