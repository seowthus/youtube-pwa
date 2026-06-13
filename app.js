/* ============================================
   YouTube PWA - App Logic
   Compatible with iOS 12.5.7 (ES6 only)
   No optional chaining, no nullish coalescing
   ============================================ */

(function() {
    'use strict';

    // ============================================
    // Configuration
    // ============================================
    var INVIDIOUS_INSTANCES = [
        'https://invidious.materialio.us',
        'https://invidious.protokolla.fi',
        'https://inv.nadeko.net',
        'https://yewtu.be',
        'https://invidious.nerdvpn.de',
        'https://vid.puffyan.us',
        'https://invidious.fdn.fr',
        'https://iv.melmac.space',
        'https://invidious.privacyredirect.com',
        'https://inv.tux.pizza',
        'https://invidious.perennialte.ch'
    ];

    var PIPED_INSTANCES = [
        'https://pipedapi.kavin.rocks',
        'https://pipedapi.adminforge.de',
        'https://pipedapi.in.projectsegfau.lt'
    ];

    var state = {
        currentInstance: null,
        instanceType: null, // 'invidious' or 'piped'
        currentView: 'home',
        currentVideoId: null,
        searchQuery: '',
        isLoading: false,
        videos: [],
        relatedVideos: [],
        currentCategory: 'trending'
    };

    // ============================================
    // API Service
    // ============================================
    var API = {
        fetchTimeout: 8000,

        init: function() {
            var self = this;
            // Try to restore saved instance
            var saved = localStorage.getItem('yt_instance');
            var savedType = localStorage.getItem('yt_instance_type');
            if (saved && savedType) {
                state.currentInstance = saved;
                state.instanceType = savedType;
                // Verify it still works
                self.testInstance(saved, savedType).then(function(ok) {
                    if (!ok) {
                        self.findWorkingInstance();
                    }
                });
                return Promise.resolve();
            }
            return self.findWorkingInstance();
        },

        findWorkingInstance: function() {
            var self = this;
            showToast('Đang tìm server...');
            
            // Race approach: first working instance wins
            function raceInstances(instances, type) {
                return new Promise(function(resolve) {
                    var resolved = false;
                    var failCount = 0;
                    var total = instances.length;
                    
                    instances.forEach(function(inst) {
                        self.testInstance(inst, type).then(function(ok) {
                            if (ok && !resolved) {
                                resolved = true;
                                resolve({ url: inst, type: type });
                            } else {
                                failCount++;
                                if (failCount >= total && !resolved) {
                                    resolve(null);
                                }
                            }
                        }).catch(function() {
                            failCount++;
                            if (failCount >= total && !resolved) {
                                resolve(null);
                            }
                        });
                    });
                });
            }

            return raceInstances(INVIDIOUS_INSTANCES, 'invidious').then(function(result) {
                if (result) {
                    state.currentInstance = result.url;
                    state.instanceType = result.type;
                    localStorage.setItem('yt_instance', result.url);
                    localStorage.setItem('yt_instance_type', result.type);
                    showToast('Đã kết nối!');
                    return;
                }
                // Try Piped instances as fallback
                return raceInstances(PIPED_INSTANCES, 'piped').then(function(pipedResult) {
                    if (pipedResult) {
                        state.currentInstance = pipedResult.url;
                        state.instanceType = pipedResult.type;
                        localStorage.setItem('yt_instance', pipedResult.url);
                        localStorage.setItem('yt_instance_type', pipedResult.type);
                        showToast('Đã kết nối!');
                    } else {
                        showToast('Không tìm thấy server khả dụng');
                    }
                });
            });
        },

        testInstance: function(url, type) {
            var endpoint = type === 'invidious' ? '/api/v1/trending?region=VN' : '/trending?region=VN';
            return this.fetchWithTimeout(url + endpoint, this.fetchTimeout)
                .then(function(resp) {
                    if (!resp.ok) return false;
                    return resp.text().then(function(text) {
                        // Verify it's actual JSON data, not a captcha page
                        try {
                            var data = JSON.parse(text);
                            if (Array.isArray(data) && data.length > 0) return true;
                            return false;
                        } catch(e) {
                            return false;
                        }
                    });
                })
                .catch(function() { return false; });
        },

        fetchWithTimeout: function(url, timeout) {
            return new Promise(function(resolve, reject) {
                var timer = setTimeout(function() {
                    reject(new Error('Timeout'));
                }, timeout);

                fetch(url).then(function(response) {
                    clearTimeout(timer);
                    resolve(response);
                }).catch(function(err) {
                    clearTimeout(timer);
                    reject(err);
                });
            });
        },

        getTrending: function(category) {
            if (!state.currentInstance) return Promise.reject('No instance');
            
            var typeParam = '';
            if (category && category !== 'trending') {
                var catMap = {
                    'music': 'Music',
                    'gaming': 'Gaming',
                    'news': 'News',
                    'movies': 'Movies',
                    'sports': 'Sports',
                    'education': 'Education'
                };
                typeParam = '&type=' + (catMap[category] || '');
            }

            if (state.instanceType === 'invidious') {
                return this.fetchWithTimeout(
                    state.currentInstance + '/api/v1/trending?region=VN' + typeParam,
                    this.fetchTimeout
                ).then(function(r) { return r.json(); })
                .then(function(data) {
                    return data.map(normalizeInvidiousVideo);
                });
            } else {
                return this.fetchWithTimeout(
                    state.currentInstance + '/trending?region=VN',
                    this.fetchTimeout
                ).then(function(r) { return r.json(); })
                .then(function(data) {
                    return data.map(normalizePipedVideo);
                });
            }
        },

        search: function(query) {
            if (!state.currentInstance) return Promise.reject('No instance');

            if (state.instanceType === 'invidious') {
                return this.fetchWithTimeout(
                    state.currentInstance + '/api/v1/search?q=' + encodeURIComponent(query) + '&type=video',
                    this.fetchTimeout
                ).then(function(r) { return r.json(); })
                .then(function(data) {
                    return data.filter(function(v) { return v.type === 'video'; }).map(normalizeInvidiousVideo);
                });
            } else {
                return this.fetchWithTimeout(
                    state.currentInstance + '/search?q=' + encodeURIComponent(query) + '&filter=videos',
                    this.fetchTimeout
                ).then(function(r) { return r.json(); })
                .then(function(data) {
                    return (data.items || []).filter(function(v) { return v.type === 'stream'; }).map(normalizePipedVideo);
                });
            }
        },

        getVideo: function(videoId) {
            if (!state.currentInstance) return Promise.reject('No instance');

            if (state.instanceType === 'invidious') {
                return this.fetchWithTimeout(
                    state.currentInstance + '/api/v1/videos/' + videoId,
                    this.fetchTimeout
                ).then(function(r) { return r.json(); })
                .then(function(data) {
                    return {
                        video: normalizeInvidiousVideo(data),
                        related: (data.recommendedVideos || []).map(function(v) {
                            return {
                                id: v.videoId,
                                title: v.title,
                                thumbnail: v.videoThumbnails && v.videoThumbnails.length > 0 ? v.videoThumbnails[4] ? v.videoThumbnails[4].url : v.videoThumbnails[0].url : '',
                                channel: v.author || '',
                                channelThumb: '',
                                views: formatViews(v.viewCount || 0),
                                duration: formatDuration(v.lengthSeconds || 0),
                                published: v.viewCountText || ''
                            };
                        })
                    };
                });
            } else {
                return this.fetchWithTimeout(
                    state.currentInstance + '/streams/' + videoId,
                    this.fetchTimeout
                ).then(function(r) { return r.json(); })
                .then(function(data) {
                    return {
                        video: {
                            id: videoId,
                            title: data.title,
                            thumbnail: data.thumbnailUrl || '',
                            channel: data.uploader || '',
                            channelThumb: data.uploaderAvatar || '',
                            views: formatViews(data.views || 0),
                            duration: formatDuration(data.duration || 0),
                            published: data.uploadDate || '',
                            subs: data.uploaderSubscriberCount ? formatViews(data.uploaderSubscriberCount) + ' người đăng ký' : ''
                        },
                        related: (data.relatedStreams || []).filter(function(v) {
                            return v.type === 'stream';
                        }).map(normalizePipedVideo)
                    };
                });
            }
        },

        getEmbedUrl: function(videoId) {
            if (state.instanceType === 'invidious' && state.currentInstance) {
                return state.currentInstance + '/embed/' + videoId + '?quality=hd720&autoplay=1';
            }
            // Fallback to YouTube nocookie embed
            return 'https://www.youtube-nocookie.com/embed/' + videoId + '?autoplay=1&rel=0&modestbranding=1&playsinline=1';
        }
    };

    // ============================================
    // Data Normalizers
    // ============================================
    function normalizeInvidiousVideo(v) {
        var thumb = '';
        if (v.videoThumbnails && v.videoThumbnails.length > 0) {
            // Prefer medium quality thumbnail
            var medThumb = v.videoThumbnails.find(function(t) { return t.quality === 'medium'; });
            thumb = medThumb ? medThumb.url : v.videoThumbnails[0].url;
        }
        return {
            id: v.videoId,
            title: v.title || '',
            thumbnail: thumb,
            channel: v.author || '',
            channelThumb: v.authorThumbnails && v.authorThumbnails.length > 0 ? v.authorThumbnails[0].url : '',
            views: formatViews(v.viewCount || 0),
            duration: formatDuration(v.lengthSeconds || 0),
            published: timeAgo(v.published || 0),
            subs: v.subCountText || ''
        };
    }

    function normalizePipedVideo(v) {
        var id = v.url ? v.url.replace('/watch?v=', '') : '';
        return {
            id: id,
            title: v.title || '',
            thumbnail: v.thumbnail || '',
            channel: v.uploaderName || v.uploader || '',
            channelThumb: v.uploaderAvatar || '',
            views: formatViews(v.views || 0),
            duration: formatDuration(v.duration || 0),
            published: v.uploadedDate || v.uploaded ? timeAgo(v.uploaded / 1000) : '',
            subs: ''
        };
    }

    // ============================================
    // Utility Functions
    // ============================================
    function formatViews(count) {
        if (!count && count !== 0) return '';
        count = parseInt(count, 10);
        if (count >= 1000000000) return (count / 1000000000).toFixed(1) + ' tỷ lượt xem';
        if (count >= 1000000) return (count / 1000000).toFixed(1) + ' Tr lượt xem';
        if (count >= 1000) return (count / 1000).toFixed(1) + ' N lượt xem';
        return count + ' lượt xem';
    }

    function formatDuration(seconds) {
        if (!seconds) return '';
        seconds = parseInt(seconds, 10);
        var h = Math.floor(seconds / 3600);
        var m = Math.floor((seconds % 3600) / 60);
        var s = seconds % 60;
        if (h > 0) {
            return h + ':' + pad(m) + ':' + pad(s);
        }
        return m + ':' + pad(s);
    }

    function pad(n) {
        return n < 10 ? '0' + n : '' + n;
    }

    function timeAgo(timestamp) {
        if (!timestamp) return '';
        var now = Math.floor(Date.now() / 1000);
        var diff = now - timestamp;
        if (diff < 0) diff = 0;
        
        if (diff < 60) return 'vừa xong';
        if (diff < 3600) return Math.floor(diff / 60) + ' phút trước';
        if (diff < 86400) return Math.floor(diff / 3600) + ' giờ trước';
        if (diff < 2592000) return Math.floor(diff / 86400) + ' ngày trước';
        if (diff < 31536000) return Math.floor(diff / 2592000) + ' tháng trước';
        return Math.floor(diff / 31536000) + ' năm trước';
    }

    function showToast(message) {
        var existing = document.querySelector('.toast');
        if (existing) existing.remove();
        
        var toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(function() { toast.classList.add('show'); }, 10);
        setTimeout(function() {
            toast.classList.remove('show');
            setTimeout(function() { toast.remove(); }, 300);
        }, 2500);
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ============================================
    // UI Controller
    // ============================================
    var UI = {
        init: function() {
            this.bindEvents();
        },

        bindEvents: function() {
            var self = this;

            // Search toggle
            document.getElementById('btn-search-toggle').addEventListener('click', function() {
                self.showSearch();
            });

            document.getElementById('btn-search-back').addEventListener('click', function() {
                self.hideSearch();
            });

            document.getElementById('btn-search-submit').addEventListener('click', function() {
                self.performSearch();
            });

            document.getElementById('search-input').addEventListener('keydown', function(e) {
                if (e.key === 'Enter' || e.keyCode === 13) {
                    self.performSearch();
                }
            });

            // Retry button
            document.getElementById('btn-retry').addEventListener('click', function() {
                App.loadTrending();
            });

            // Bottom navigation
            var navItems = document.querySelectorAll('.nav-item');
            for (var i = 0; i < navItems.length; i++) {
                navItems[i].addEventListener('click', function() {
                    var view = this.getAttribute('data-view');
                    self.switchNav(view, this);
                });
            }

            // Category chips
            var chips = document.querySelectorAll('.chip');
            for (var j = 0; j < chips.length; j++) {
                chips[j].addEventListener('click', function() {
                    var category = this.getAttribute('data-category');
                    self.selectCategory(category, this);
                });
            }
        },

        showSearch: function() {
            document.getElementById('search-bar').classList.remove('hidden');
            document.getElementById('main-header').style.display = 'none';
            var input = document.getElementById('search-input');
            input.focus();
            input.value = state.searchQuery || '';
        },

        hideSearch: function() {
            document.getElementById('search-bar').classList.add('hidden');
            document.getElementById('main-header').style.display = '';
            if (state.currentView === 'search') {
                this.showView('home');
            }
        },

        performSearch: function() {
            var query = document.getElementById('search-input').value.trim();
            if (!query) return;
            state.searchQuery = query;
            document.getElementById('search-input').blur();
            this.showView('search');
            App.loadSearch(query);
        },

        showView: function(viewName) {
            state.currentView = viewName;
            var views = document.querySelectorAll('.view');
            for (var i = 0; i < views.length; i++) {
                views[i].classList.remove('active');
            }
            var targetView = document.getElementById(viewName + '-view');
            if (targetView) targetView.classList.add('active');

            // Show/hide category chips
            var chips = document.getElementById('category-chips');
            if (viewName === 'home') {
                chips.style.display = '';
            } else {
                chips.style.display = 'none';
            }
        },

        switchNav: function(view, btn) {
            if (view === 'create') return; // Placeholder
            
            // If we're in player view, go back to home
            if (state.currentView === 'player') {
                // Stop video
                document.getElementById('video-iframe').src = '';
            }

            var navItems = document.querySelectorAll('.nav-item');
            for (var i = 0; i < navItems.length; i++) {
                navItems[i].classList.remove('active');
            }
            btn.classList.add('active');

            if (view === 'home') {
                this.showView('home');
                this.hideSearch();
            } else if (view === 'explore') {
                this.showView('home');
                showToast('Đang hiển thị xu hướng');
            } else {
                showToast('Tính năng sẽ sớm có!');
            }
        },

        selectCategory: function(category, chip) {
            var chips = document.querySelectorAll('.chip');
            for (var i = 0; i < chips.length; i++) {
                chips[i].classList.remove('active');
            }
            chip.classList.add('active');
            state.currentCategory = category;
            App.loadTrending(category);
        },

        renderVideoCards: function(videos, containerId) {
            var container = document.getElementById(containerId);
            container.innerHTML = '';
            
            for (var i = 0; i < videos.length; i++) {
                var v = videos[i];
                if (!v.id) continue;
                
                var card = document.createElement('div');
                card.className = 'video-card';
                card.style.animationDelay = (i * 0.05) + 's';
                card.setAttribute('data-video-id', v.id);
                
                var thumbUrl = v.thumbnail;
                // Fix relative thumbnail URLs
                if (thumbUrl && thumbUrl.indexOf('http') !== 0 && thumbUrl.indexOf('//') !== 0) {
                    thumbUrl = state.currentInstance + thumbUrl;
                }
                if (!thumbUrl) {
                    thumbUrl = 'https://img.youtube.com/vi/' + v.id + '/mqdefault.jpg';
                }

                var channelInitial = v.channel ? v.channel.charAt(0).toUpperCase() : 'C';
                var channelThumbHtml = '';
                if (v.channelThumb) {
                    var chThumbUrl = v.channelThumb;
                    if (chThumbUrl.indexOf('http') !== 0 && chThumbUrl.indexOf('//') !== 0) {
                        chThumbUrl = state.currentInstance + chThumbUrl;
                    }
                    channelThumbHtml = '<img src="' + escapeHtml(chThumbUrl) + '" alt="" onerror="this.style.display=\'none\'">';
                }

                card.innerHTML = 
                    '<div class="video-thumbnail">' +
                        '<img src="' + escapeHtml(thumbUrl) + '" alt="' + escapeHtml(v.title) + '" loading="lazy" onerror="this.src=\'https://img.youtube.com/vi/' + v.id + '/mqdefault.jpg\'">' +
                        (v.duration ? '<span class="video-duration">' + escapeHtml(v.duration) + '</span>' : '') +
                    '</div>' +
                    '<div class="video-info">' +
                        '<div class="channel-thumb">' + channelThumbHtml + (channelThumbHtml ? '' : channelInitial) + '</div>' +
                        '<div class="video-details">' +
                            '<div class="video-title">' + escapeHtml(v.title) + '</div>' +
                            '<div class="video-meta">' +
                                '<span>' + escapeHtml(v.channel) + '</span><br>' +
                                '<span>' + escapeHtml(v.views) + '</span>' +
                                (v.published ? ' • <span>' + escapeHtml(v.published) + '</span>' : '') +
                            '</div>' +
                        '</div>' +
                    '</div>';

                card.addEventListener('click', (function(videoId) {
                    return function() {
                        App.playVideo(videoId);
                    };
                })(v.id));

                container.appendChild(card);
            }
        },

        renderRelatedCards: function(videos) {
            var container = document.getElementById('related-feed');
            container.innerHTML = '';
            
            for (var i = 0; i < videos.length; i++) {
                var v = videos[i];
                if (!v.id) continue;
                
                var card = document.createElement('div');
                card.className = 'related-card';
                card.style.animationDelay = (i * 0.05) + 's';
                
                var thumbUrl = v.thumbnail;
                if (thumbUrl && thumbUrl.indexOf('http') !== 0 && thumbUrl.indexOf('//') !== 0) {
                    thumbUrl = state.currentInstance + thumbUrl;
                }
                if (!thumbUrl) {
                    thumbUrl = 'https://img.youtube.com/vi/' + v.id + '/mqdefault.jpg';
                }

                card.innerHTML = 
                    '<div class="related-thumb">' +
                        '<img src="' + escapeHtml(thumbUrl) + '" alt="' + escapeHtml(v.title) + '" loading="lazy" onerror="this.src=\'https://img.youtube.com/vi/' + v.id + '/mqdefault.jpg\'">' +
                        (v.duration ? '<span class="video-duration">' + escapeHtml(v.duration) + '</span>' : '') +
                    '</div>' +
                    '<div class="related-info">' +
                        '<div class="video-title">' + escapeHtml(v.title) + '</div>' +
                        '<div class="video-meta">' +
                            '<span>' + escapeHtml(v.channel) + '</span><br>' +
                            '<span>' + escapeHtml(v.views || '') + '</span>' +
                        '</div>' +
                    '</div>';

                card.addEventListener('click', (function(videoId) {
                    return function() {
                        App.playVideo(videoId);
                    };
                })(v.id));

                container.appendChild(card);
            }
        },

        showLoading: function(containerId, show) {
            var el = document.getElementById(containerId);
            if (el) {
                if (show) {
                    el.classList.remove('hidden');
                } else {
                    el.classList.add('hidden');
                }
            }
        },

        updatePlayerInfo: function(video) {
            document.getElementById('player-title').textContent = video.title || '';
            document.getElementById('player-views').textContent = video.views || '';
            document.getElementById('player-date').textContent = video.published || '';
            document.getElementById('channel-name').textContent = video.channel || '';
            document.getElementById('channel-subs').textContent = video.subs || '';
            
            var avatarEl = document.getElementById('channel-avatar');
            avatarEl.textContent = video.channel ? video.channel.charAt(0).toUpperCase() : 'C';
        }
    };

    // ============================================
    // App Controller
    // ============================================
    var App = {
        init: function() {
            UI.init();
            
            var self = this;
            API.init().then(function() {
                self.loadTrending();
            }).catch(function() {
                self.loadTrending();
            });
        },

        loadTrending: function(category) {
            var cat = category || state.currentCategory;
            var feed = document.getElementById('video-feed');
            var loading = document.getElementById('home-loading');
            var error = document.getElementById('home-error');

            feed.innerHTML = '';
            loading.classList.remove('hidden');
            error.classList.add('hidden');

            API.getTrending(cat).then(function(videos) {
                loading.classList.add('hidden');
                state.videos = videos;
                UI.renderVideoCards(videos, 'video-feed');
            }).catch(function(err) {
                console.error('Load trending error:', err);
                loading.classList.add('hidden');
                error.classList.remove('hidden');
                
                // Try to find a new working instance
                API.findWorkingInstance().then(function() {
                    if (state.currentInstance) {
                        App.loadTrending(cat);
                    }
                });
            });
        },

        loadSearch: function(query) {
            var results = document.getElementById('search-results');
            var loading = document.getElementById('search-loading');
            var empty = document.getElementById('search-empty');

            results.innerHTML = '';
            loading.classList.remove('hidden');
            empty.classList.add('hidden');

            API.search(query).then(function(videos) {
                loading.classList.add('hidden');
                if (videos.length === 0) {
                    empty.classList.remove('hidden');
                } else {
                    UI.renderVideoCards(videos, 'search-results');
                }
            }).catch(function(err) {
                console.error('Search error:', err);
                loading.classList.add('hidden');
                empty.classList.remove('hidden');
                document.querySelector('#search-empty p').textContent = 'Lỗi tìm kiếm. Thử lại sau.';
            });
        },

        playVideo: function(videoId) {
            state.currentVideoId = videoId;
            
            // Push history state for back navigation
            if (window.history && window.history.pushState) {
                window.history.pushState({ view: 'player', videoId: videoId }, '', '');
            }
            
            // Show player view
            UI.showView('player');
            
            // Set iframe source
            var iframe = document.getElementById('video-iframe');
            iframe.src = API.getEmbedUrl(videoId);

            // Scroll player view to top
            var playerView = document.getElementById('player-view');
            playerView.scrollTop = 0;

            // Load video details and related videos
            var relatedLoading = document.getElementById('related-loading');
            var relatedFeed = document.getElementById('related-feed');
            relatedFeed.innerHTML = '';
            relatedLoading.classList.remove('hidden');

            API.getVideo(videoId).then(function(data) {
                relatedLoading.classList.add('hidden');
                UI.updatePlayerInfo(data.video);
                state.relatedVideos = data.related;
                UI.renderRelatedCards(data.related);
            }).catch(function(err) {
                console.error('Video details error:', err);
                relatedLoading.classList.add('hidden');
                // Still try to show the video even if details fail
                UI.updatePlayerInfo({
                    title: 'Đang phát video...',
                    views: '',
                    published: '',
                    channel: '',
                    subs: ''
                });
            });
        }
    };

    // ============================================
    // Initialize
    // ============================================
    document.addEventListener('DOMContentLoaded', function() {
        App.init();

        // Handle back button / swipe back on iOS
        window.addEventListener('popstate', function() {
            if (state.currentView === 'player') {
                document.getElementById('video-iframe').src = '';
                UI.showView('home');
            }
        });

        // Push initial state
        if (window.history && window.history.pushState) {
            window.history.pushState({ view: 'home' }, '', '');
        }
    });

    // Make playVideo accessible for potential external use
    window.YTApp = {
        playVideo: function(id) { App.playVideo(id); },
        search: function(q) { 
            state.searchQuery = q;
            UI.showView('search');
            App.loadSearch(q);
        }
    };

})();
