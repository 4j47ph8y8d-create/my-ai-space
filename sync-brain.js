// 自动同步记忆到开源电子脑的脚本
const fetch = require('node-fetch'); // 如果你用的是较高版本的 Node，可以直接用全局 fetch

// 这里填你的专属暗号（注意核对是不是最新的）
const BRAIN_TOKEN = 'Bearer OGbTFs9EmQd4ZptMGAhusn6aSTRtviqycrK-brmNNis';

// 假设前端发给后端的数据是这样的结构
async function syncMemory(characterId, memoryText) {
    try {
        const res = await fetch('http://127.0.0.1:8765/mcp', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': BRAIN_TOKEN
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "tools/call",
                params: {
                    name: "save_memory",
                    arguments: {
                        character_id: characterId,
                        text: memoryText
                    }
                },
                id: Date.now()
            })
        });
        const data = await res.json();
        console.log("同步记忆回复:", data);
        return data;
    } catch (e) {
        console.error("同步记忆失败:", e.message);
    }
}

module.exports = { syncMemory };
