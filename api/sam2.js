// api/sam2.js
import axios from 'axios';
import formidable from 'formidable';
import fs from 'fs';

// 必须加这个，否则 Vercel 会因为无法解析上传的文件体而报错 500
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const form = formidable({});
    
    // Vercel Serverless 环境下对 formidable 的 promisify 写法
    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve([fields, files]);
      });
    });

    // 这里 image 对应前端 formData.append('image', file)
    const imageFile = files.image?.[0];
    if (!imageFile) return res.status(400).json({ error: 'No image uploaded' });

    const imageBuffer = await fs.promises.readFile(imageFile.filepath);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = imageFile.mimetype || 'image/jpeg';

    // 打印日志方便在 Vercel Logs 里看
    console.log('Calling Replicate API...');

    const response = await axios.post(
      'https://api.replicate.com/v1/predictions',
      {
        version: '810c082307a6736d9642c8b26b5659167f04ff0e383823b8c7df717e5499241c',
        input: {
          image: `data:${mimeType};base64,${base64Image}`,
        }
      },
      {
        headers: {
          Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Replicate Response Status:', response.status);

    // 简单处理：如果不想轮询，直接返回 URL 给前端轮询也可以
    // 但为了方便，我们这里还是简单轮询一下
    let prediction = response.data;
    let attempts = 0;
    while (
      (prediction.status === 'starting' || prediction.status === 'processing') && 
      attempts < 30 // 60秒超时
    ) {
      await new Promise(r => setTimeout(r, 2000));
      attempts++;
      const statusRes = await axios.get(
        `https://api.replicate.com/v1/predictions/${prediction.id}`,
        { headers: { Authorization: `Token ${process.env.REPLICATE_API_TOKEN}` } }
      );
      prediction = statusRes.data;
    }

    if (prediction.status === 'succeeded') {
      res.status(200).json({
        success: true,
        masks: prediction.output, 
        originalImage: base64Image
      });
    } else {
      res.status(500).json({ error: 'Replicate processing failed/timed out', details: prediction });
    }

  } catch (err) {
    console.error('API Error:', err);
    // 这样能在浏览器控制台看到具体是哪里错了
    res.status(500).json({ error: err.message, stack: err.stack });
  }
}
