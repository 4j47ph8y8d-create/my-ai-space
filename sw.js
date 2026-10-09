// ============================================================
// Service Worker —— 只缓存静态资源，不缓存 HTML
// ============================================================

var CACHE_NAME = 'lunar-reverie-static-v1';

// 安装时，不预缓存任何东西（避免缓存旧 html）
self.addEventListener('install', function(event) {
    self.skipWaiting();
});

// 激活时，清理掉所有旧缓存
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(names) {
            return Promise.all(
                names.map(function(name) {
                    if (name !== CACHE_NAME) {
                        return caches.delete(name);
                    }
                })
            );
        }).then(function() {
            return self.clients.claim();
        })
    );
});

// 拦截请求
self.addEventListener('fetch', function(event) {
    var request = event.request;
    var url = new URL(request.url);

    // ⭐ 关键：HTML 永远走网络，不走缓存
    // 只要不是 GET，或者不是同源的，直接放过
    if (request.method !== 'GET') {
        return;
    }

    // html、js、json 这些要每次从网络拉，避免"看到旧版本"
    var pathname = url.pathname.toLowerCase();
    if (
        pathname.endsWith('.html') ||
        pathname.endsWith('/') ||
        pathname === '/' ||
        pathname.endsWith('index.html') ||
        pathname.endsWith('.js') ||
        pathname.endsWith('.json')
    ) {
        // 不做任何缓存，直接走网络
        return;
    }

    // 图片、字体、音频、css 这些可以走缓存（提高加载速度）
    event.respondWith(
        caches.match(request).then(function(cached) {
            if (cached) return cached;

            return fetch(request).then(function(response) {
                // 只缓存成功的、同源的
                if (!response || response.status !== 200 || response.type !== 'basic') {
                    return response;
                }

                var responseClone = response.clone();
                caches.open(CACHE_NAME).then(function(cache) {
                    cache.put(request, responseClone);
                });

                return response;
            });
        })
    );
});
