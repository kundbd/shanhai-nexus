const original=globalThis.fetch;
globalThis.fetch=async function(address,options) {
  if(address!=="https://api.deepseek.com/chat/completions")return original(address,options);
  const input=JSON.parse(options.body);
  const {text}=JSON.parse(input.messages[1].content);
  if(text.includes("模拟审核服务暂不可用"))return new globalThis.Response(null,{status:503});
  const evidence=text.match(/模拟违规证据[一二]/)?.[0];
  const verdict=evidence?{decision:"violation",category:"scam",evidence}:{decision:"allow"};
  return globalThis.Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(verdict)}}]});
};
