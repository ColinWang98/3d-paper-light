import axios from 'axios';
import formidable from 'formidable';
import fs from 'fs';

export const config = {
  api: {
    bodyParser: false, // 关键：禁用 Vercel 默认解析，交给 formidable
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const form = formidable({});
    
    // 使用 Promise 包装 form.parse
    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve([fields, files]);
      });
    });

    const imageFile = files.image?.[0];
    
    if (!imageFile) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    const imageBuffer = await fs.promises.readFile(imageFile.filepath);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = imageFile.mimetype || 'image/jpeg';

    // 调用 Replicate
    const response = await axios.post(
      'https://api.replicate.com/v1/predictions',
      {
        version: '810c082307a6736d9642c8b26b5659167f04ff0e383823b8c7df717e5499241c',
        input: {
          image: `data:${mimeType};base64,${base64Image}`,
          return_type: 'masks', // 强制返回 masks
        }
      },
      {
        headers: {
          Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    let prediction = response.data;
    
    // 轮询直到完成
    while (prediction.status === 'starting' || prediction.status === 'processing') {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const statusResponse = await axios.get(
        `https://api.replicate.com/v1/predictions/${prediction.id}`,
        {
          headers: { Authorization: `Token ${process.env.REPLICATE_API_TOKEN}` }
        }
      );
      prediction = statusResponse.data;
    }

    if (prediction.status === 'succeeded') {
      res.status(200).json({
        success: true,
        masks: prediction.output, 
        originalImage: base64Image
      });
    } else {
      res.status(500).json({ error: 'SAM-2 failed', details: prediction.error });
    }

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: error.message });
  }
}
