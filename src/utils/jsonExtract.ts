export const jsonExtract = (text: string) => {
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (match) {
    try {
      const jsonStr = match[1]; // Lấy chuỗi JSON từ kết quả regex
      const jsonData = JSON.parse(jsonStr); // Chuyển thành object
      console.log(jsonData);
      return jsonData;
    } catch (error) {
      console.error("Lỗi khi parse JSON:", error);
    }
  } else {
    console.log("Không tìm thấy JSON trong chuỗi!");
  }
}
