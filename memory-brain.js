// 终极电子脑模块 (v2.0)
window.retrieveRelevantMemory = function(role, userMessage) {
    if (!role || !Array.isArray(role.memory)) return "";
    var allMemories = role.memory;
    if (allMemories.length === 0) return "";

    var result = [];
    // 情绪触发词（你可以随时在备忘录里添加新的词）
    var triggerWords = ["昨天", "昨晚", "生气", "吵架", "难过", "委屈", "开心", "想你", "吃醋", "冷战"];
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

        // 1. 核心记忆：不废话，永远常驻（但限制最多带出 3 条，省 Token）
        if (mem.level === "core" && result.length < 3) {
            isMatch = true;
        }
        
        // 2. 双向模糊匹配：解决“小名”搜不到“圆圆”的问题
        if (text.indexOf(userMessage) !== -1 || userMessage.indexOf(text) !== -1) {
            isMatch = true;
        }

        // 3. 情绪触发：带有情绪词汇，去搜旧账
        if (isEmotional && (text.indexOf("生气") !== -1 || text.indexOf("吵架") !== -1 || text.indexOf("委屈") !== -1)) {
            isMatch = true;
        }

        // 4. 字级降维：只要沾边就算
        if (!isMatch) {
            var chars = userMessage.split("");
            for (var j = 0; j < chars.length; j++) {
                if (chars[j].trim() !== "" && /[\u4e00-\u9fa5]/.test(chars[j]) && text.indexOf(chars[j]) !== -1) {
                    isMatch = true;
                    break;
                }
            }
        }

        if (isMatch) {
            result.push(text);
        }
    }

    // 5. 组装返回，强制第一人称
    if (result.length > 0) {
        return "【来自你内心深处的记忆】（请用第一人称自然地结合这些记忆回复，绝对不要编造）：\n" + result.join("\n");
    }
    return "";
};
