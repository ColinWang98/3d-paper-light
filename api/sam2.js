import formidable from 'formidable';
import fs from 'fs';
import Replicate from 'replicate'; // 引入官方 SDK

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

    console.log('Calling Replicate API (Official SDK)...');

    // 初始化 Replicate SDK
    // 它会自动读取 process.env.REPLICATE_API_TOKEN
    const replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN,
    });

    // 使用你找到的最新 SAM-2 Hash
    const output = await replicate.run(
      "meta/sam-2:fe97b453a6455861e3bac769b441ca1f1086110da7466dbb65cf1eecfd60dc83",
      {
        input: {
          image: dataUri,
          // ⚠️ 注意：官方 SAM-2 的 "自动分割" 并不叫 auto_segment
          // 如果你不传任何 prompt (box, point)，它默认可能不会返回 mask 数组
          // 但既然我们要试错，先只传 image 试试它的默认行为
          // 如果报错 "missing prompts"，我们再换回之前的 sam-1
        }
      }
    );

    console.log('Replicate Output:', output);

    // SAM-2 的输出结构可能变了，通常是：
    // { combined_mask: "url...", masks: ["url1", "url2"...] }
    // 或者直接返回 masks 数组
    
    // 容错处理：找到任何看起来像 mask 数组的东西
    let masks = [];
    if (Array.isArray(output)) {
      masks = output;
    } else if (output && Array.isArray(output.masks)) {
      masks = output.masks;
    } else if (output && output.segmentation_masks) {
       masks = output.segmentation_masks;
    } else if (output) {
       // 如果只返回了一个对象，可能只有一个结果，硬塞进数组
       masks = [output];
    }

    res.status(200).json({
      success: true,
      masks: masks, 
      originalImage: base64Image
    });

  } catch (err) {
    console.error('API Error:', err);
    res.status(500).json({ error: err.message });
  }
}
