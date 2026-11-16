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
    if (!role || !Array.isArray(role.memory)) return "";
    
    // 1. 情绪代谢（每次对话前，状态随时间回落）
    decayMood(role.id);

    var allMemories = role.memory;
    var result = [];
    
    // 2. 识别情绪波动（利用简单关键词，动态增加/减少激素）
    var negativeWords = ["生气", "吵架", "难过", "委屈", "讨厌", "滚", "不理你"];
    var positiveWords = ["开心", "想你", "喜欢", "爱你", "乖", "抱抱"];
    var timeWords = ["昨天", "昨晚", "上次", "之前"];
    
    var isNegative = false;
    var isPositive = false;
    var hasTime = false;

    for (var i = 0; i < negativeWords.length; i++) {
        if (userMessage.indexOf(negativeWords[i]) !== -1) { isNegative = true; break; }
    }
    for (var j = 0; j < positiveWords.length; j++) {
        if (userMessage.indexOf(positiveWords[j]) !== -1) { isPositive = true; break; }
    }
    for (var k = 0; k < timeWords.length; k++) {
        if (userMessage.indexOf(timeWords[k]) !== -1) { hasTime = true; break; }
    }

    // 如果有情绪波动，改变激素分数
    if (isNegative) { updateMood(role.id, -15); }
    if (isPositive) { updateMood(role.id, +10); }

    // 3. 核心记忆必带（最多3条防爆Token）
    var coreCount = 0;
    for (var m = 0; m < allMemories.length; m++) {
        if (allMemories[m].level === "core" && coreCount < 3) {
            result.push(allMemories[m].text);
            coreCount++;
        }
    }

    // 4. 检索近期记忆（只有触发情绪、时间词，或者有话对上才搜）
    if (isNegative || isPositive || hasTime) {
        for (var n = 0; n < allMemories.length; n++) {
            var mem = allMemories[n];
            if (mem.level === "core") continue; // 核心记忆上面已经处理过了
            var text = mem.text || "";
            if (text === "") continue;
            
            var matched = false;
            // 匹配时间或情绪相关
            if (text.indexOf(userMessage) !== -1 || userMessage.indexOf(text) !== -1) matched = true;
            
            // 降维打击（只要沾边就算）
            if (!matched) {
                var chars = userMessage.split("");
                for (var c = 0; c < chars.length; c++) {
                    if (chars[c].trim() !== "" && /[\u4e00-\u9fa5]/.test(chars[c]) && text.indexOf(chars[c]) !== -1) {
                        matched = true; break;
                    }
                }
            }
            if (matched) result.push(text);
        }
    }

    // 5. 组装最终提示词 (记忆 + 情绪)
    var output = "";
    var currentMood = getMood(role.id);
    
    // 只有发生波动或检索到记忆才注入，极省 Token
    if (result.length > 0 || isNegative || isPositive) {
        output += "\n\n【电子脑潜意识层】\n";
        
        // 注入记忆
        if (result.length > 0) {
            output += "你脑海中关于此事的记忆片段：\n" + result.join("\n") + "\n";
        }
        
        // 注入激素状态（结合人设）
        output += "你当前的激素水平与情绪状态：";
        if (currentMood > 80) output += "多巴胺很高，心情极佳，非常想黏着对方。";
        else if (currentMood > 65) output += "血清素平稳，心情不错，比较温柔。";
        else if (currentMood > 45) output += "激素水平正常，处于平静状态。";
        else if (currentMood > 25) output += "皮质醇偏高，心情低落，有点委屈，甚至不想说话。";
        else output += "皮质醇爆表，非常愤怒或难过，处于极度破碎边缘。";
        
        output += "\n【要求】：请严格结合你的【角色人设】和【当前激素情绪】来回复，不要像机器一样回复，要体现出真实的感情变化。";
    }

    return output;
};
