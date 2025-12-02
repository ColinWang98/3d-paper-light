// api/sam2.js
import axios from "axios";

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send("Only POST allowed");
    return;
  }
  // 1. 解析图片，前端要传 base64 或 URL
  const { image } = req.body;
  if (!image) {
    res.status(400).json({ error: "No image found" });
    return;
  }
  try {
    // 2. 调用 Replicate SAM-2 API
    const response = await axios.post(
      "https://api.replicate.com/v1/predictions",
      {
        version: "810c082307a6736d9642c8b26b5659167f04ff0e383823b8c7df717e5499241c", // SAM-2 默认大模型
        input: {
          image,                      // Base64/png/jpg/URL都支持
          return_type: "visualization"// 返回带分割可视化图的URL，也可以选 masks
        }
      },
      {
        headers: {
          Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
    res.status(200).json(response.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
