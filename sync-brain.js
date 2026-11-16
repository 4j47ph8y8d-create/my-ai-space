// sync-brain.js (支持多用户的隔离版本)
async function syncMemory(userId, characterId, memoryText) {
    try {
        // 暂时写死暗号，等跑通了，我们再加自动获取暗号的逻辑
        const BRAIN_TOKEN = 'Bearer OGbTFs9EmQd4ZptMGAhusn6aSTRtviqycrK-brmNNis'; 
        
        // 这里的 owner_id 就是开源大脑用来区分不同用户的钥匙
        // 我们把用户的 userId 传进去，保证每个人的记忆只存在自己的脑区
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
                        owner_id: userId,       // 用户隔离：是谁存的
                        character_id: characterId, // 角色隔离：存给谁的
                        text: memoryText        // 存了什么
                    }
                },
                id: Date.now()
            })
        });
        const data = await res.json();
        console.log("存入大脑的回复:", data);
        return data;
    } catch (e) {
        console.error("同步到电子脑失败:", e.message);
    }
}

module.exports = { syncMemory };
