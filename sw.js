// ============================================================
//  LunarReverie Service Worker
//  关键原则：只缓存静态资源，API 请求直接放行
// ============================================================

const CACHE_NAME = 'lunar-reverie-v2';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/phone.html',
    '/mall.html',
    '/memory.html',
    '/manifest.json',
    '/icon.PNG'
];

// 安装：缓存静态资源
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll(STATIC_ASSETS).catch(function(e) {
                console.warn('部分静态资源缓存失败:', e);
            });
        })
    );
    self.skipWaiting();
});

// 激活：清理旧缓存
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(names) {
            return Promise.all(
                names.filter(function(name) {
                    return name !== CACHE_NAME;
                }).map(function(name) {
                    return caches.delete(name);
                })
            );
        })
    );
    self.clients.claim();
});

// 请求拦截：只缓存静态资源，API 请求全部放行
self.addEventListener('fetch', function(event) {
    var url = event.request.url;
    var method = event.request.method;

    // ===== 关键：以下请求直接放行，SW 不拦截 =====
    // 1. 所有非 GET 请求（POST/PUT/DELETE 等）
    // 2. DeepSeek API
    // 3. 阿里云百炼（图片生成）
    // 4. 同域的 /api/ 路径（你的后端）
    // 5. 所有跨域请求
    if (method !== 'GET' ||
        url.includes('api.deepseek.com') ||
        url.includes('dashscope.aliyuncs.com') ||
        url.includes('/api/') ||
        !url.startsWith(self.location.origin)) {
        // 不调用 respondWith，让浏览器直接请求
        return;
    }

    // ===== 静态资源：网络优先，失败时用缓存 =====
    event.respondWith(
        fetch(event.request).then(function(response) {
            if (response && response.status === 200) {
                var responseClone = response.clone();
                caches.open(CACHE_NAME).then(function(cache) {
                    cache.put(event.request, responseClone);
                });
            }
            return response;
        }).catch(function() {
            return caches.match(event.request).then(function(cached) {
                return cached || new Response('离线', { status: 503 });
            });
        })
    );
});
