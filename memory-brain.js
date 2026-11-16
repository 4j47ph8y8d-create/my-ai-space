// ==========================================
// 终极电子脑 (记忆 + 情绪动态激素版) v3.0
// ==========================================

// 情绪状态管理（0-100，基线为60，极低为0，极高为100）
function getMood(roleId) {
    var key = "mood_" + roleId;
    var saved = localStorage.getItem(key);
    return saved ? parseInt(saved) : 60;
}

function updateMood(roleId, delta) {
    var current = getMood(roleId);
    var next = current + delta;
    if (next > 100) next = 100;
    if (next < 0) next = 0;
    localStorage.setItem("mood_" + roleId, next);
}

// 每次聊天时，情绪自然回落（慢慢代谢回 60）
function decayMood(roleId) {
    var current = getMood(roleId);
    if (current > 60) { updateMood(roleId, -2); }
    if (current < 60) { updateMood(roleId, +2); }
}

window.retrieveRelevantMemory = function(role, userMessage) {
    var allMemories = [];
    
    // 1. 优先尝试从传进来的角色数据里拿记忆
    if (role && Array.isArray(role.memory)) {
        allMemories = role.memory;
    }
    
    // 2. 兜底方案：如果上面是空的（或者闪烁导致丢了），直接从浏览器底层强制读取！
    if (allMemories.length === 0) {
        try {
            var raw = localStorage.getItem("ds_multiRole_v2");
            if (raw) {
                var data = JSON.parse(raw);
                if (data && data.roles) {
                    var realRole = data.roles.find(function(r) { return r.id === role.id; });
                    if (realRole && Array.isArray(realRole.memory)) {
                        allMemories = realRole.memory;
                    }
                }
            }
        } catch(e) {}
    }

    if (allMemories.length === 0) return "";

    var result = [];
    var triggerWords = ["昨天", "昨晚", "生气", "吵架", "难过", "委屈", "开心", "想你", "吃醋", "冷战", "小名", "记得"];
    var isEmotional = false;
    for (var k = 0; k < triggerWords.length; k++) {
        if (userMessage.indexOf(triggerWords[k]) !== -1) {
            isEmotional = true;
            break;
        }
    }

    for (var i = 0; i < allMemories.length; i++) {
        var mem = allMemories[i];
        var text = mem.text || "";
        if (text === "") continue;

        var isMatch = false;

        // 核心记忆，无条件直接塞进去
        if (mem.level === "core") {
            isMatch = true;
        }
        
        // 模糊匹配
        if (text.indexOf(userMessage) !== -1 || userMessage.indexOf(text) !== -1) {
            isMatch = true;
        }

        // 字级匹配
        if (!isMatch) {
            var chars = userMessage.split("");
            for (var j = 0; j < chars.length; j++) {
                if (chars[j].trim() !== "" && /[\u4e00-\u9fa5]/.test(chars[j]) && text.indexOf(chars[j]) !== -1) {
                    isMatch = true;
                    break;
                }
            }
        }

        if (isMatch) result.push(text);
    }

    if (result.length > 0) {
        // 用极其强硬的语气，禁止 AI 编造！
        return "\n\n【系统强制指令：绝对事实】\n" +
               "以下是你脑海中拥有的真实记忆：\n" +
               result.join("\n") + "\n" +
               "⚠️【底线要求】：请你直接用上述事实回答用户。**绝对禁止**凭空编造事实里没有的小名、往事或设定。如果事实里写的是“圆圆”，你就必须叫“圆圆”，不准瞎编别的名字！";
    }
    return "";
};
