import { OpenAI } from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const callChatGPT = async (prompt: string): Promise<string> => {
  const response = await openai.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'gpt-4',
  });
  return response.choices[0].message.content || '';
};

export const promptLLM = async (transcript: string): Promise<string> => {
  const prompt = `
    Phân tích đoạn hội thoại chăm sóc khách hàng sau đây và trích xuất thông tin theo định dạng JSON.
    ### **Yêu cầu xử lý:**
    - **Xác định & trích xuất thông tin theo các tiêu chí sau:**
    1. **Thông tin khách hàng**:  
        - Tên khách hàng (nếu có, không lấy đại từ xưng hô như Chị, Anh, Ông, Bà).  
        - Số điện thoại khách hàng (nếu có).  
        - Email khách hàng (nếu có).  
    2. **Thông tin nhân viên tổng đài**:  
        - Tên nhân viên hỗ trợ.  
    3. **Vấn đề khách hàng gặp phải**:  
        - Mô tả ngắn gọn vấn đề chính khách hàng phản ánh hoặc thắc mắc.  
    4. **Giải pháp được đưa ra**:  
        - Mô tả cách nhân viên chăm sóc khách hàng giải quyết vấn đề.  
    5. **Chủ đề cuộc trò chuyện**:  
        - Phân loại cuộc trò chuyện vào một trong các chủ đề như:  
        \`["đặt phòng", "hủy phòng", "khiếu nại dịch vụ", "yêu cầu thông tin", "hỗ trợ kỹ thuật", v.v.]\`.  

    - **Yêu cầu đầu ra:**  
    - Chỉ trả về dữ liệu dưới dạng JSON, đặt trong JSON quote, không kèm bất kỳ thông tin nào khác.  
    - Dữ liệu JSON phải có cấu trúc như sau:

    Định dạng JSON kết quả mong muốn:
    \`\`\`json
    {
        "customer": {
            "name": "[Tên khách hàng]",
            "phone_number": "[Số điện thoại khách hàng]",
            "email": "[Email khách hàng]"
        },
        "agent": {
            "name": "[Tên nhân viên tổng đài]"
        },
        "issue": "[Vấn đề khách hàng gặp phải]",
        "solution": "[Giải pháp được đưa ra]",
        "topic": "[Chủ đề của cuộc trò chuyện]",
        "transcript": "[Đoạn hội thoại đã được sửa lỗi chính tả]" 
    }
    \`\`\`

    Đoạn hội thoại: ${transcript}
  `;
  return callChatGPT(prompt);
};