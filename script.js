// --- State Management ---
let state = {
    entries: [],
    products: [],    // {id, name, price, image}
    sales: [],       // {id, timestamp, items: [], total}
    slotCounts: {},  // {slotId: count}
    settings: {
        capacityPerSlot: 20,
        eventName: "3/15 丹波ルロット",
        eventDate: "2026/03/15",
        hpUrl: "https://chaplus-0u0.github.io/Sticker-exchange-event/",
        formNotice: "事前予約は無料で受け付けています。\n当日は10時のイベント開始時から窓口で当日分の受付を行います！",
        completionNotice: "※今回は無料でご参加いただけますが、次回以降は有料になる可能性があります。\n※当日スムーズにご案内できるようご協力をお願いいたします！",
        topNotice: "ここにイベントのお知らせ案内が表示されます✨",
        topImage: "",
        gasUrl: "https://script.google.com/macros/s/AKfycbxKqkvvSDLWc2M6NkxzyMJ9_8DWPspAfQWUB6fOi6gVRDRmgvW50V9jzrX1uNWDTa9k/exec",
        adminPassword: "admin"
    },
    currentSlotFilter: 'all', // 初期値は「すべて」
    lastUpdated: 0
};

let isAdminAuth = sessionStorage.getItem('sticker_admin_auth') === 'true';
let currentCart = [];

const slots = {
    slot1: { name: "10:00–10:30", prefix: "①", type: "pre" },
    slot2: { name: "10:45–11:15", prefix: "②", type: "pre" },
    slot3: { name: "11:30–12:00", prefix: "③", type: "walk-in" },
    slot4: { name: "12:15–12:45", prefix: "④", type: "pre" },
    slot5: { name: "13:00–13:30", prefix: "⑤", type: "pre" },
    slot6: { name: "13:45–14:15", prefix: "⑥", type: "walk-in" },
    slot7: { name: "14:30–15:00", prefix: "⑦", type: "walk-in" }
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    // 1. まずデータを読み込み（チラつき防止のため最優先）
    await loadData();

    // 2. アクセス判定と画面表示（この時点でデータがstateに入っている）
    checkAccess();

    // 3. イベントリスナーなどの初期化
    initApp();

    // 4. 最終的な表示更新
    refreshActiveView();
});

/**
 * 現在アクティブな（表示されている）ビューの表示内容を最新データで更新する
 */
function refreshActiveView() {
    const activeView = document.querySelector('.view.active');
    if (!activeView) return;
    const targetId = activeView.id;

    if (targetId === 'reception-view') updateReceptionList();
    if (targetId === 'pos-view') refreshPOS();
    if (targetId === 'product-admin-view') updateAdminProductList();
    if (targetId === 'admin-view') {
        updateSettingsUI();
        applySettingsToInputs();
    }
    if (targetId === 'top-view') updateSettingsUI();
    if (targetId === 'sales-view') {
        updateSalesHistoryUI();
        updateTodaySales();
        updateSlotSummary();
    }
}

async function loadData() {
    console.log("--- Loading Data ---");
    const saved = localStorage.getItem('sticker_exchange_data');
    // ... (existing deserialization)
    if (saved) {
        try {
            const data = JSON.parse(saved);
            // stateオブジェクトの参照を壊さないようにプロパティ単位で更新
            if (data.entries) state.entries = data.entries;
            if (data.products) state.products = data.products;
            if (data.sales) state.sales = data.sales;
            if (data.slotCounts) state.slotCounts = data.slotCounts;
            if (data.settings) state.settings = { ...state.settings, ...data.settings };
            if (data.lastUpdated) state.lastUpdated = data.lastUpdated;
        } catch (e) {
            console.error("Corrupted local data:", e);
        }
        // 後方互換性ガード & 配列初期化保証
        if (!state.settings) state.settings = {};
        if (!Array.isArray(state.entries)) state.entries = [];
        if (!Array.isArray(state.products)) state.products = [];
        if (!Array.isArray(state.sales)) state.sales = [];
        if (!state.slotCounts) state.slotCounts = {};
    }

    // ハードコードされたGAS URLを常に適用
    const HARDCODED_GAS_URL = "https://script.google.com/macros/s/AKfycbxKqkvvSDLWc2M6NkxzyMJ9_8DWPspAfQWUB6fOi6gVRDRmgvW50V9jzrX1uNWDTa9k/exec";
    if (state.settings) {
        state.settings.gasUrl = HARDCODED_GAS_URL;
        if (!state.settings.capacityPerSlot) state.settings.capacityPerSlot = 20;
    }

    // 2. クラウド同期 (URLが設定されている場合)
    if (state.settings.gasUrl) {
        updateSyncStatus('syncing');
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);

            const response = await fetch(`${state.settings.gasUrl}?action=get`, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (response.ok) {
                const cloudData = await response.json();
                if (cloudData) {
                    const localTime = state.lastUpdated || 0;
                    const cloudTime = cloudData.lastUpdated || 0;

                    // 単純な上書きではなく、コレクションごとにマージを行う
                    console.log(`Syncing: Local(${localTime}) vs Cloud(${cloudTime})`);

                    // 1. 配列データのマージ
                    state.entries = mergeCollections(state.entries || [], cloudData.entries || []);
                    state.sales = mergeCollections(state.sales || [], cloudData.sales || []);

                    // 商品データは特に慎重にマージ
                    const localProducts = state.products || [];
                    const cloudProducts = cloudData.products || [];
                    state.products = mergeCollections(localProducts, cloudProducts);

                    // 2. 設定とカウントは新しい方を優先
                    if (cloudTime > localTime) {
                        state.settings = {
                            ...state.settings,
                            ...cloudData.settings,
                            gasUrl: HARDCODED_GAS_URL
                        };
                        // slotCounts (当日受付数) の同期
                        if (cloudData.slotCounts) {
                            state.slotCounts = cloudData.slotCounts;
                        }
                        state.lastUpdated = cloudTime;
                        // 設定画面の入力欄を更新
                        applySettingsToInputs();
                        updateSettingsUI();
                    }

                    localStorage.setItem('sticker_exchange_data', JSON.stringify(state));

                    if (localTime >= cloudTime) {
                        syncToCloud();
                    }
                }
                // recalculateSlotCounts() は手入力分を消去してしまうため呼ばないか、
                // あるいは当日分を別で合算するように修正が必要。
                // 今回は「当日受付」と「予約分」を分けたため、
                // 手入力分である slotCounts を recalculate で上書きしてはいけない。

                updateSyncStatus('success');
            }
        } catch (e) {
            console.warn("Cloud load failed:", e);
            updateSyncStatus('error');
        }
    }
}

function saveData() {
    state.lastUpdated = Date.now();
    try {
        localStorage.setItem('sticker_exchange_data', JSON.stringify(state));
        console.log("Data saved to localStorage. items:", state.entries.length);
    } catch (e) {
        console.error("Save failed:", e);
        if (e.name === 'QuotaExceededError' || e.code === 22) {
            alert("⚠️ 保存容量がいっぱいです！\n古い売上履歴を削除するか、不要な商品を削除して空き容量を増やしてください。");
        } else {
            alert("⚠️ 保存中にエラーが発生しました。");
        }
    }
    updateTodaySales();
    syncToCloud();
}

function updateSyncStatus(status) {
    const el = document.getElementById('sync-status');
    if (!el) return;

    // 現在のストレージ使用量を計算 (localStorageの制限は約5MB)
    const usageStr = localStorage.getItem('sticker_exchange_data') || "";
    const usagePercent = Math.min(100, Math.round((usageStr.length / (5 * 1024 * 1024)) * 100));
    const usageText = ` [容量:${usagePercent}%]`;

    switch (status) {
        case 'syncing': el.textContent = '🔄 同期中...'; el.style.color = '#ffa726'; break;
        case 'success': el.textContent = '✅ 同期完了'; el.style.color = '#66bb6a'; break;
        case 'error': el.textContent = '⚠️ 接続エラー'; el.style.color = '#ef5350'; break;
        case 'quota_error': el.textContent = '⚠️ 容量不足 (要整理)'; el.style.color = '#ff7043'; break;
        default: el.textContent = '未設定'; el.style.color = '#888';
    }
    el.textContent += usageText;
}

async function syncToCloud() {
    if (!state.settings.gasUrl) {
        console.warn("Sync: No GAS URL configured.");
        return;
    }

    updateSyncStatus('syncing');
    try {
        const payload = JSON.stringify(state);
        console.log("Sync: Sending data to cloud. Size:", payload.length);

        const response = await fetch(state.settings.gasUrl, {
            method: 'POST',
            body: payload,
            mode: 'no-cors'
        });

        // no-corsではレスポンス内容は見れないが、到達はしたとみなす
        updateSyncStatus('success');
        console.log("Sync: Data sent (no-cors mode)");
    } catch (e) {
        console.error("Sync: Cloud push failed:", e);
        updateSyncStatus('error');
    }
}

async function forceSyncToCloud() {
    if (!confirm("現在のiPadのデータをクラウド(スプレッドシート)に強制的に上書き送信します。よろしいですか？\n※他の端末で入力したデータよりこちらが優先されます。")) return;

    state.lastUpdated = Date.now(); // タイムスタンプを強制更新
    saveData();
    alert("クラウドへデータを送信しました✨\nスプレッドシート側を確認してください。");
}

/**
 * 二つのコレクション（オブジェクトの配列）をIDに基づいてマージする
 * @param {Array} localLocal 
 * @param {Array} cloudRemote 
 * @returns {Array} マージされた配列
 */
function mergeCollections(local, cloud) {
    if (!Array.isArray(cloud)) return local || [];
    if (!Array.isArray(local)) return cloud || [];

    const merged = [...local];
    const localIds = new Set(local.map(item => item.id));

    cloud.forEach(cloudItem => {
        if (!localIds.has(cloudItem.id)) {
            merged.push(cloudItem);
        } else {
            // IDが重複する場合、基本的には「新しい方」を採用したいが、
            // 簡易化のため一旦local側（現在の操作）を優先しつつ
            // もしCloud側にしか無いプロパティがあれば補完するなどの拡張が可能
            const localIndex = merged.findIndex(item => item.id === cloudItem.id);
            // タイムスタンプがあれば比較するロジックも追加可能
        }
    });

    return merged;
}

// アクセス制御
function checkAccess() {
    const urlParams = new URLSearchParams(window.location.search);
    const viewParam = urlParams.get('view');
    const isAdminViewReq = viewParam === 'admin';
    const isFormViewReq = viewParam === 'form';

    document.getElementById('login-modal').classList.add('hidden');

    // どの画面を表示するか判定
    let defaultAdminTab = sessionStorage.getItem('sticker_last_view') || 'pos-view';
    // 不正な値やadmin-view(設定)以外への誘導を防ぐためのガード
    const validAdminTabs = ['pos-view', 'sales-view', 'product-admin-view', 'registration-view', 'reception-view', 'admin-view', 'data-management-view'];
    if (!validAdminTabs.includes(defaultAdminTab)) defaultAdminTab = 'pos-view';

    if (isFormViewReq) {
        // ?view=form は誰でも(ログイン・未ログイン問わず)最優先で表示
        document.getElementById('main-nav').classList.add('hidden');
        switchView(null, 'registration-view', false); // 保存しない
    } else if (isAdminAuth) {
        // 管理者認証済み
        document.getElementById('main-nav').classList.remove('hidden');
        const activeBtn = document.querySelector(`[data-target="${defaultAdminTab}"]`);
        switchView(activeBtn, defaultAdminTab, false); // 初期ロード時は再保存不要
    } else {
        // 一般向けトップページ優先
        document.getElementById('main-nav').classList.add('hidden');
        switchView(null, 'top-view', false);

        // 管理画面へ直通URLを踏んだか、認証がない場合は強制ログイン
        if (isAdminViewReq) {
            document.getElementById('login-modal').classList.remove('hidden');
        }
    }
}
function initApp() {
    // ---- ログイン・ログアウト ----
    document.getElementById('btn-login').addEventListener('click', () => {
        const pw = document.getElementById('login-password').value;
        if (!pw.trim()) {
            alert("パスワードを入力してください");
            return;
        }
        if (pw === state.settings.adminPassword || pw === 'admin') {
            isAdminAuth = true;
            sessionStorage.setItem('sticker_admin_auth', 'true');
            window.history.replaceState({}, document.title, window.location.pathname + '?view=admin');
            checkAccess();
        } else {
            alert("パスワードが違います😢");
        }
    });

    if (document.getElementById('btn-logout')) {
        document.getElementById('btn-logout').addEventListener('click', () => {
            if (confirm("ログアウトしますか？")) {
                isAdminAuth = false;
                sessionStorage.removeItem('sticker_admin_auth');
                location.href = window.location.pathname; // TOPへ戻る
            }
        });
    }

    // ---- TOPページ用アクション ----
    if (document.getElementById('btn-go-reserve')) {
        document.getElementById('btn-go-reserve').addEventListener('click', () => {
            switchView(null, 'registration-view');
            window.scrollTo(0, 0);
        });
    }

    if (document.getElementById('admin-reveal-dot')) {
        document.getElementById('admin-reveal-dot').addEventListener('click', () => {
            document.getElementById('login-modal').classList.remove('hidden');
        });
    }

    // ログインモーダル外側クリックで閉じる（ログインキャンセル）
    document.getElementById('login-modal').addEventListener('click', (e) => {
        if (e.target.id === 'login-modal') {
            e.target.classList.add('hidden');
            // 管理者ページを直接叩いた場合はTOPに戻す
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('view') === 'admin') {
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        }
    });

    // ---- ナビゲーション ----
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-target');
            switchView(btn, target);
        });
    });

    // ---- 設定タブ関連 ----
    updateSettingsUI();
    applySettingsToInputs(); // 初回起動時のみ入力を同期
    document.getElementById('btn-save-settings').addEventListener('click', () => {
        state.settings.eventName = document.getElementById('setting-event-name').value;
        state.settings.eventDate = document.getElementById('setting-event-date').value;
        state.settings.hpUrl = document.getElementById('setting-hp-url').value;
        state.settings.topNotice = document.getElementById('setting-top-notice').value;
        state.settings.formNotice = document.getElementById('setting-form-notice').value;
        state.settings.completionNotice = document.getElementById('setting-completion-notice').value;
        state.settings.gasUrl = document.getElementById('setting-gas-url').value;
        saveData();
        updateSettingsUI();
        applySettingsToInputs(); // 保存後に再同期
        alert("設定を保存しました✨");
    });

    document.getElementById('btn-force-sync').addEventListener('click', forceSyncToCloud);

    // TOP画像アップロード処理
    document.getElementById('setting-top-img').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (evt) => {
                state.settings.topImage = evt.target.result;
                updateSettingsUI();
            };
            reader.readAsDataURL(file);
        }
    });

    document.getElementById('btn-clear-top-img').addEventListener('click', () => {
        state.settings.topImage = "";
        document.getElementById('setting-top-img').value = "";
        updateSettingsUI();
    });

    // ---- データ・バックアップ復元 ----
    document.getElementById('btn-export-backup').addEventListener('click', () => {
        const dataStr = JSON.stringify(state, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const dateStr = new Date().toISOString().slice(0, 10);
        a.download = `sticker_exchange_backup_${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    document.getElementById('input-import-backup').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!confirm("データを復元すると、現在のiPad(この端末)の中身は全て消えてバックアップの内容に上書きされます。よろしいですか？")) {
            e.target.value = ''; // 選択クリア
            return;
        }

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const importedData = JSON.parse(evt.target.result);
                // 簡単なデータ整合性チェック
                if (importedData && typeof importedData === 'object' && importedData.settings) {
                    state = importedData;
                    saveData();
                    alert("✅ データの復元が完了しました！\n画面を再読み込みします。");
                    location.reload();
                } else {
                    alert('❌ 無効なデータファイルです。シール交換会アプリのバックアップファイルを選んでください。');
                }
            } catch (err) {
                console.error(err);
                alert("❌ ファイルの読み込み中にエラーが発生しました。");
            }
            e.target.value = ''; // リセット
        };
        reader.readAsText(file);
    });

    document.getElementById('btn-clear-all').addEventListener('click', () => {
        if (confirm("名簿データ、売上、人数カウントをリセットします。商品情報は消えません。よろしいですか？")) {
            state.entries = [];
            state.sales = [];
            state.slotCounts = {}; // 確実にリセット
            saveData();

            // クラウド同期対応のため、少し待ってからリロード（またはUI直接クリア）
            alert("リセットが完了しました✨");
            updateReceptionList();
            updatePOSCounterDisplay();
            updateTodaySales();
            if (typeof refreshPOS === 'function') refreshPOS();
        }
    });

    // 本当に全て（商品含め）消したい場合用の隠し機能（コンソール用など）
    window.fullReset = () => {
        if (confirm("商品情報も含め、全てのデータを完全に消去します。")) {
            localStorage.removeItem('sticker_exchange_data');
            location.reload();
        }
    };

    // ---- 予約フォーム ----
    populateSlotSelects();
    const regForm = document.getElementById('registration-form');
    regForm.addEventListener('submit', handleRegistration);
    document.getElementById('btn-reset-form').addEventListener('click', () => {
        document.getElementById('registration-result').classList.add('hidden');
        document.getElementById('registration-form').classList.remove('hidden');
        regForm.reset();
    });

    // ---- 受付（名簿）タブ ----
    document.getElementById('search-input').addEventListener('input', updateReceptionList);
    const hideCheckedInCb = document.getElementById('filter-hide-checked-in');
    if (hideCheckedInCb) {
        hideCheckedInCb.addEventListener('change', updateReceptionList);
    }
    document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
    document.getElementById('btn-export-reception-csv').addEventListener('click', exportCSV);
    document.getElementById('btn-export-sales-csv').addEventListener('click', exportSalesCSV);
    document.getElementById('btn-generate-test').addEventListener('click', generateTestData);
    document.getElementById('btn-generate-test-products').addEventListener('click', generateTestProducts);

    // ---- 商品管理タブ ----
    initProductAdmin();

    // ---- POS（レジ）タブ ----
    initPOS();

    // ---- 番号チェック連携 ----
    document.getElementById('btn-pos-check-number').addEventListener('click', handleNumberCheck);

    document.getElementById('btn-clear-old-sales').addEventListener('click', () => {
        if (confirm("24時間以上前の古い売上履歴を削除して、保存容量を確保しますか？\n(本日の最新データは消えません)")) {
            const now = Date.now();
            const oneDayInMs = 24 * 60 * 60 * 1000;
            const originalCount = state.sales.length;

            state.sales = state.sales.filter(s => {
                const ts = parseInt(s.id.split('_')[1]);
                return !isNaN(ts) && (now - ts < oneDayInMs);
            });

            saveData();
            updateSalesHistoryUI();
            updateTodaySales();
            alert(`整理完了しました。(${originalCount - state.sales.length}件を削除)`);
        }
    });

    // ---- 短縮URL・QRコード機能 (ライブラリ未読込でも落ちないように保護) ----
    try {
        initShortUrlFeatures();
    } catch (e) {
        console.error("ShortUrl init failed:", e);
    }
}

function initShortUrlFeatures() {
    const qrContainer = document.getElementById('qrcode-container');
    const btnCopy = document.getElementById('btn-copy-form-url');
    const publicUrlLink = document.getElementById('public-form-url');

    if (!qrContainer || !publicUrlLink) return;

    // 現在のベースURLからフォーム用URLを生成
    const baseUrl = window.location.origin + window.location.pathname;
    const publicUrl = `${baseUrl}?view=form`;

    publicUrlLink.href = publicUrl;
    publicUrlLink.textContent = publicUrl;

    // 即座にQRコードを生成
    generateQRCode(qrContainer, publicUrl);

    if (btnCopy) {
        btnCopy.addEventListener('click', () => {
            navigator.clipboard.writeText(publicUrl).then(() => {
                const originalText = btnCopy.textContent;
                btnCopy.textContent = "✅ コピー完了";
                btnCopy.classList.add('btn-success');
                setTimeout(() => {
                    btnCopy.textContent = originalText;
                    btnCopy.classList.remove('btn-success');
                }, 2000);
            });
        });
    }
}

function applySettingsToInputs() {
    const safeSetValue = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val || "";
    };

    safeSetValue('setting-event-name', state.settings.eventName);
    safeSetValue('setting-event-date', state.settings.eventDate);
    safeSetValue('setting-hp-url', state.settings.hpUrl);
    safeSetValue('setting-top-notice', state.settings.topNotice);
    safeSetValue('setting-form-notice', state.settings.formNotice);
    safeSetValue('setting-completion-notice', state.settings.completionNotice);
    safeSetValue('setting-gas-url', state.settings.gasUrl);
}

function updateSettingsUI() {
    const safeSetText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    safeSetText('app-title-display', `🎀 ${state.settings.eventName || ""} 🎀`);
    safeSetText('event-date-display', `📅 開催日: ${state.settings.eventDate || ""}`);

    // タブタイトル（<title>）の反映
    document.title = state.settings.eventName ? `${state.settings.eventName}✨受付` : "シール交換会✨受付";

    // TOPページの反映
    safeSetText('top-event-title', `🎀 ${state.settings.eventName || ""} 🎀`);
    safeSetText('top-event-date', `📅 開催日: ${state.settings.eventDate || ""}`);

    // TOPページの案内と画像の反映
    const topNoticeArea = document.getElementById('top-notice-area');
    if (topNoticeArea) {
        if (state.settings.topNotice && state.settings.topNotice.trim() !== "") {
            topNoticeArea.textContent = state.settings.topNotice;
            topNoticeArea.style.display = 'block';
        } else {
            topNoticeArea.style.display = 'none';
        }
    }

    const topImgView = document.getElementById('top-view-image');
    const topImgPreview = document.getElementById('setting-top-img-preview');
    const topImgClearBtn = document.getElementById('btn-clear-top-img');
    const topImage = state.settings.topImage;

    if (topImage) {
        if (topImgView) { topImgView.src = topImage; topImgView.style.display = 'block'; }
        if (topImgPreview) { topImgPreview.src = topImage; topImgPreview.style.display = 'block'; }
        if (topImgClearBtn) topImgClearBtn.style.display = 'inline-block';
    } else {
        if (topImgView) topImgView.style.display = 'none';
        if (topImgPreview) topImgPreview.style.display = 'none';
        if (topImgClearBtn) topImgClearBtn.style.display = 'none';
    }

    // フッターのHP(SNS)リンク更新
    const footerHp = document.getElementById('footer-hp-link');
    if (footerHp) {
        if (state.settings.hpUrl) {
            if (!footerHp.querySelector('a')) {
                footerHp.innerHTML = `<a href="${state.settings.hpUrl}" target="_blank" class="hp-link">📱 イベントのSNS・リンクはこちら</a>`;
            } else {
                footerHp.querySelector('a').href = state.settings.hpUrl;
            }
        } else {
            footerHp.innerHTML = "";
        }
    }

    // 各種案内文
    const setNotice = (id, text) => {
        const el = document.getElementById(id);
        if (el) {
            if (text && text.trim() !== "") {
                el.textContent = text;
                el.style.display = 'block';
            } else {
                el.style.display = 'none';
            }
        }
    };
    setNotice('form-notice-area', state.settings.formNotice);
    setNotice('completion-notice-area', state.settings.completionNotice);

    updateTodaySales();

    // 公開URLの生成と表示
    const publicUrlEl = document.getElementById('public-form-url');
    if (publicUrlEl) {
        const currentUrl = new URL(window.location.href);
        currentUrl.search = '?view=form';
        publicUrlEl.href = currentUrl.href;
        publicUrlEl.textContent = currentUrl.href;
    }
}

// 画面切り替え
function switchView(btn, targetId, shouldSave = true) {
    if (btn) {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const targetEl = document.getElementById(targetId);
    if (targetEl) {
        targetEl.classList.add('active');
        window.scrollTo(0, 0); // 切り替え時に上端に戻す
        if (shouldSave && isAdminAuth) {
            sessionStorage.setItem('sticker_last_view', targetId);
        }
    }

    if (targetId === 'top-view') updateSettingsUI();
    if (targetId === 'admin-view') {
        updateSettingsUI();
        applySettingsToInputs(); // 管理画面に入るたびに最新状態を同期
    }
    if (targetId === 'reception-view') {
        state.currentSlotFilter = 'all'; // 最初はすべて表示
        updateReceptionList();
    }
    if (targetId === 'pos-view') refreshPOS();
    if (targetId === 'product-admin-view') updateAdminProductList();
    if (targetId === 'sales-view') {
        updateSalesHistoryUI();
        updateTodaySales();
        updateSlotSummary();
    }
}

// --- 予約フォーム ---
function populateSlotSelects() {
    const regSlot = document.getElementById('reg-slot');
    const posSlot = document.getElementById('pos-slot-select');
    regSlot.innerHTML = '<option value="">選択してください</option>';
    posSlot.innerHTML = '';

    Object.keys(slots).forEach(key => {
        const slot = slots[key];

        // 予約フォーム用
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = `${slot.name} ${slot.type === 'pre' ? '(事前予約枠)' : '(当日枠: 事前予約不可)'}`;
        if (slot.type !== 'pre') opt.disabled = true;

        // 定員チェック
        const countInSlot = state.entries.filter(en => en.slotId === key).length;
        if (countInSlot >= state.settings.capacityPerSlot) {
            opt.disabled = true;
            opt.textContent += ' 【満席】';
        }
        regSlot.appendChild(opt);

        // POS用
        const posOpt = document.createElement('option');
        posOpt.value = key;
        posOpt.textContent = slot.name;
        posSlot.appendChild(posOpt);
    });
}

function handleRegistration(e) {
    e.preventDefault();
    const selectedSlotId = document.getElementById('reg-slot').value;
    const userName = document.getElementById('user-name').value.trim();
    const userPhone = document.getElementById('user-phone').value.trim();

    if (!selectedSlotId || !userName || !userPhone) return;

    const countInSlot = state.entries.filter(en => en.slotId === selectedSlotId).length;
    if (countInSlot >= state.settings.capacityPerSlot) {
        alert("ごめんなさい！この時間枠は定員に達しました。");
        populateSlotSelects(); // UI更新
        return;
    }

    const nextNum = countInSlot + 1;
    const formattedNum = String(nextNum).padStart(3, '0');
    const displayNum = slots[selectedSlotId].prefix ? `${slots[selectedSlotId].prefix}-${formattedNum}` : formattedNum;

    const newEntry = {
        id: Date.now().toString(),
        slotId: selectedSlotId,
        slotName: slots[selectedSlotId].name,
        name: userName,
        phone: userPhone,
        number: displayNum,
        status: 'pending',
        timestamp: new Date().toLocaleString()
    };

    state.entries.push(newEntry);
    saveData();
    populateSlotSelects();

    document.getElementById('registration-form').classList.add('hidden');
    document.getElementById('registration-result').classList.remove('hidden');
    document.getElementById('res-slot-txt').textContent = newEntry.slotName;
    document.getElementById('res-number').textContent = newEntry.number;
    window.scrollTo({ top: 0, behavior: 'smooth' });
}


// --- 商品管理 (Admin) ---
let pendingImageBase64 = "";

function initProductAdmin() {
    const imgInput = document.getElementById('prod-img');
    const imgPreview = document.getElementById('prod-img-preview');
    const btnAdd = document.getElementById('btn-add-product');

    imgInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = async function (event) {
                const rawBase64 = event.target.result;
                // 画像を圧縮してから保存
                pendingImageBase64 = await compressImage(rawBase64);
                imgPreview.src = pendingImageBase64;
                imgPreview.style.display = 'block';
            };
            reader.readAsDataURL(file);
        }
    });

    btnAdd.addEventListener('click', () => {
        const id = document.getElementById('prod-id-editing').value;
        const name = document.getElementById('prod-name').value.trim();
        const price = parseInt(document.getElementById('prod-price').value);

        if (!name || isNaN(price)) {
            alert("商品名と値段を正しく入力してください");
            return;
        }

        // 二重登録防止
        btnAdd.disabled = true;
        btnAdd.textContent = "⌛ 保存中...";

        setTimeout(() => {
            if (id) {
                // 更新
                const idx = state.products.findIndex(p => p.id === id);
                if (idx !== -1) {
                    state.products[idx] = {
                        ...state.products[idx],
                        name: name,
                        price: price,
                        image: pendingImageBase64 || state.products[idx].image
                    };
                }
                document.getElementById('prod-id-editing').value = '';
            } else {
                // 新規
                const newProd = {
                    id: 'prod_' + Date.now(),
                    name: name,
                    price: price,
                    image: pendingImageBase64 || ''
                };
                state.products.push(newProd);
            }

            saveData();

            // リセット
            document.getElementById('prod-name').value = '';
            document.getElementById('prod-price').value = '';
            imgInput.value = '';
            imgPreview.style.display = 'none';
            pendingImageBase64 = "";

            updateAdminProductList();

            btnAdd.disabled = false;
            btnAdd.textContent = "商品を追加 / 更新";
            alert(id ? "商品を更新しました✨" : "商品を追加しました✨");
        }, 300);
    });
}

function updateAdminProductList() {
    const list = document.getElementById('admin-product-list');
    list.innerHTML = '';

    if (state.products.length === 0) {
        list.innerHTML = '<p class="placeholder-text">まだ商品がありません</p>';
        return;
    }

    state.products.forEach(p => {
        const item = document.createElement('div');
        item.className = 'admin-product-item';

        // SVG内のダブルクォートをエスケープまたは避ける
        const imgSrc = p.image ? p.image : `data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='50' height='50'%3E%3Crect width='50' height='50' fill='%23eee'/%3E%3C/svg%3E`;

        item.innerHTML = `
            <img src="${imgSrc}" alt="${p.name.replace(/"/g, '&quot;')}">
            <div class="admin-product-info">
                <div class="name">${p.name}</div>
                <div class="price">¥${p.price}</div>
            </div>
            <button class="btn-checkin" style="background:#4fc3f7; border:none; color:white; padding:5px 10px; border-radius:10px; cursor:pointer;" onclick="editProduct('${p.id}')">編集</button>
            <button class="btn-checkin" style="background:#ff8a80; border:none; color:white; padding:5px 10px; border-radius:10px; cursor:pointer;" onclick="deleteProduct('${p.id}')">削除</button>
        `;
        list.appendChild(item);
    });
}

window.editProduct = function (id) {
    const p = state.products.find(prod => prod.id === id);
    if (!p) return;

    document.getElementById('prod-id-editing').value = p.id;
    document.getElementById('prod-name').value = p.name;
    document.getElementById('prod-price').value = p.price;

    const imgPreview = document.getElementById('prod-img-preview');
    if (p.image) {
        imgPreview.src = p.image;
        imgPreview.style.display = 'block';
    } else {
        imgPreview.style.display = 'none';
    }

    document.getElementById('btn-add-product').textContent = "商品を更新する";
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.deleteProduct = function (id) {
    if (confirm("この商品を削除しますか？")) {
        state.products = state.products.filter(p => p.id !== id);
        saveData();
        updateAdminProductList();
    }
};


// --- POS レジ & カウンター ---
function initPOS() {
    const slotSelect = document.getElementById('pos-slot-select');

    // スロット変更時
    slotSelect.addEventListener('change', () => {
        updatePOSCounterDisplay();
    });

    // カウンター
    document.getElementById('btn-count-minus').addEventListener('click', () => {
        const slotId = slotSelect.value;
        if (!state.slotCounts[slotId]) state.slotCounts[slotId] = 0;
        if (state.slotCounts[slotId] > 0) state.slotCounts[slotId]--;
        saveData();
        updatePOSCounterDisplay();
    });

    document.getElementById('btn-count-plus').addEventListener('click', () => {
        const slotId = slotSelect.value;
        if (!state.slotCounts[slotId]) state.slotCounts[slotId] = 0;
        state.slotCounts[slotId]++;
        saveData();
        updatePOSCounterDisplay();
    });

    // 手入力の追加
    document.getElementById('btn-add-manual').addEventListener('click', () => {
        const nameInput = document.getElementById('pos-manual-name').value.trim();
        const priceInput = parseInt(document.getElementById('pos-manual-price').value, 10);
        if (isNaN(priceInput) || priceInput < 0) {
            alert("正しい金額を入力してください");
            return;
        }

        const name = nameInput || "手入力商品";
        currentCart.push({
            id: 'manual_' + Date.now(),
            name: name,
            price: priceInput,
            qty: 1
        });

        document.getElementById('pos-manual-name').value = '';
        document.getElementById('pos-manual-price').value = '';
        updateCartUI();
    });

    // カートクリア
    document.getElementById('btn-cart-clear').addEventListener('click', () => {
        currentCart = [];
        document.getElementById('cart-tendered-amount').value = '';
        updateCartUI();
    });

    // お預かり金額の入力監視
    document.getElementById('cart-tendered-amount').addEventListener('input', updateChangeCalculation);

    // 会計
    document.getElementById('btn-checkout').addEventListener('click', () => {
        if (currentCart.length === 0) return;

        const total = currentCart.reduce((sum, item) => sum + (item.price * item.qty), 0);

        const sale = {
            id: 'sale_' + Date.now(),
            timestamp: new Date().toLocaleString(),
            items: [...currentCart],
            total: total
        };

        state.sales.push(sale);
        saveData();

        const tenderedInput = document.getElementById('cart-tendered-amount');
        const tendered = parseInt(tenderedInput.value);
        const changeText = (!isNaN(tendered) && tendered > total) ? `\nお預かり: ¥${tendered}\nおつり: ¥${tendered - total}` : `\nお渡し: 丁度 (¥${total})`;

        currentCart = [];
        tenderedInput.value = '';
        updateCartUI();
        updateSalesHistoryUI(); // 履歴を更新
        updateTodaySales(); // 今日の売上を更新
        alert(`会計完了しました！\n合計: ¥${total}${changeText}`);
    });
}

function refreshPOS() {
    updatePOSCounterDisplay();
    updateSalesHistoryUI();

    // 商品グリッドの描画
    const grid = document.getElementById('product-grid');
    grid.innerHTML = '';

    if (state.products.length === 0) {
        grid.innerHTML = '<p class="placeholder-text" style="grid-column: 1/-1;">商品が登録されていません。<br>「商品管理」から追加してください。</p>';
    } else {
        state.products.forEach(p => {
            const tile = document.createElement('div');
            tile.className = 'product-tile';
            const imgSrc = p.image ? p.image : `data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%23eee'/%3E%3C/svg%3E`;

            tile.innerHTML = `
                <img src="${imgSrc}" loading="lazy" alt="${p.name.replace(/"/g, '&quot;')}">
                <div class="name">${p.name}</div>
                <div class="price">¥${p.price}</div>
            `;

            tile.addEventListener('click', () => addToCart(p));
            grid.appendChild(tile);
        });
    }

    updateCartUI();
}

function updateSalesHistoryUI() {
    const tbody = document.getElementById('pos-sales-history-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    // 最新のものを上に表示するためリバースして最大30件表示
    const recentSales = [...state.sales].reverse().slice(0, 30);

    if (recentSales.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#999;">まだ売上がありません</td></tr>';
        return;
    }

    recentSales.forEach(sale => {
        const tr = document.createElement('tr');

        let itemNames = sale.items.map(i => `${i.name}×${i.qty}`).join(', ');
        if (itemNames.length > 20) itemNames = itemNames.substring(0, 20) + '...';

        // HH:MM 形式の抽出 (簡易版)
        const timeMatch = sale.timestamp.match(/\d{1,2}:\d{2}/) || [sale.timestamp];
        const displayTime = timeMatch[0];

        tr.innerHTML = `
            <td>${displayTime}</td>
            <td>${itemNames}</td>
            <td style="text-align:right;"><strong>¥${sale.total.toLocaleString()}</strong></td>
            <td style="padding-left: 20px;">
                <div style="display:flex; gap:5px;">
                    <button class="btn-checkin" onclick="editSaleEntry('${sale.id}')" style="background:#4fc3f7; border:none; color:white; padding:4px 8px; font-size: 0.8rem; border-radius:8px;">修正</button>
                    <button class="btn-delete-entry" onclick="deleteSaleEntry('${sale.id}')" style="padding: 4px 8px; font-size: 0.8rem;">取消</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function compressImage(base64Str, maxWidth = 320, quality = 0.6) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = base64Str;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            if (width > maxWidth) {
                height *= maxWidth / width;
                width = maxWidth;
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            // 本番用にさらに圧縮率を高める
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => resolve(base64Str); // 失敗時は元のまま
    });
}

window.editSaleEntry = function (saleId) {
    const sale = state.sales.find(s => s.id === saleId);
    if (!sale) return;

    if (currentCart.length > 0) {
        if (!confirm("カートに商品が入っています。上書きして修正を開始しますか？")) return;
    }

    // カートに読み戻す
    currentCart = [...sale.items];

    // 商品名からstate.productsに存在するものを紐付けておく（必要なら）
    // updateCartUIがIDベースで動いているならIDが一致する必要がある

    // 元の売上を削除（修正後に再度会計してもらう形式）
    state.sales = state.sales.filter(s => s.id !== saleId);

    saveData();
    switchView(null, 'pos-view');
    updateSalesHistoryUI();
    updateCartUI();
    updateTodaySales();

    alert("売上データをカートに読み込みました。内容を修正して再度「会計する」を押してください。");
};

window.deleteSaleEntry = function (saleId) {
    if (confirm("この売上を取り消しますか？\n（本日の売上合計からも減算されます）")) {
        state.sales = state.sales.filter(s => s.id !== saleId);
        saveData();
        updateSalesHistoryUI();
        updateTodaySales();
    }
};

function updatePOSCounterDisplay() {
    const slotId = document.getElementById('pos-slot-select').value;
    if (!slotId) return;

    // 当日受付分 (手入力)
    const manualCount = state.slotCounts[slotId] || 0;
    // 予約分 (名簿からステータス取得)
    const reservedCheckedIn = state.entries.filter(en => en.slotId === slotId && en.status === 'checked-in').length;
    const reservedTotal = state.entries.filter(en => en.slotId === slotId).length;

    // 当日カウンター表示の更新
    const countEl = document.getElementById('pos-slot-count');
    if (countEl) countEl.textContent = manualCount;

    const headerManualEl = document.getElementById('pos-header-manual-count');
    if (headerManualEl) headerManualEl.textContent = manualCount;

    // ヘッダーの進捗表示: 予約 ◯/◯名 | 当日 ◯名
    const statusEl = document.getElementById('pos-checkin-status');
    if (statusEl) {
        statusEl.innerHTML = `
            <span class="label">予約受付</span> <span class="count">${reservedCheckedIn}</span> / <span class="total">${reservedTotal}</span>名
            <span class="sep">|</span>
            <span class="label">当日受付</span> <span class="count">${manualCount}</span>名
        `;
    }

    updatePOSSuggestions();
}

function updatePOSSuggestions() {
    const slotId = document.getElementById('pos-slot-select').value;
    const datalist = document.getElementById('pos-number-suggestions');
    if (!datalist) return;
    datalist.innerHTML = '';

    if (!slotId) return;

    // 現在の時間帯で、まだ未受付の人だけを抽出
    const unCheckedEntries = state.entries.filter(en => en.slotId === slotId && en.status !== 'checked-in');

    // 入力候補として追加
    unCheckedEntries.forEach(entry => {
        const option = document.createElement('option');
        // valueを実際の番号（①-001など）にし、ラベルに名前を出します
        option.value = entry.number;
        option.textContent = `${entry.name} 様`;
        datalist.appendChild(option);
    });
}

function addToCart(product) {
    const existing = currentCart.find(item => item.id === product.id);
    if (existing) {
        existing.qty++;
    } else {
        currentCart.push({
            id: product.id,
            name: product.name,
            price: product.price,
            qty: 1
        });
    }
    updateCartUI();
}

window.removeFromCart = function (id) {
    currentCart = currentCart.filter(item => item.id !== id);
    updateCartUI();
};

function updateCartUI() {
    const cartContainer = document.getElementById('cart-items');
    cartContainer.innerHTML = '';

    let total = 0;

    if (currentCart.length === 0) {
        cartContainer.innerHTML = '<p class="placeholder-text">空っぽです</p>';
        document.getElementById('btn-checkout').disabled = true;
    } else {
        currentCart.forEach(item => {
            total += item.price * item.qty;
            const el = document.createElement('div');
            el.className = 'cart-item';
            el.innerHTML = `
                <div class="name">${item.name}</div>
                <div class="price">¥${item.price}</div>
                <div class="qty">x${item.qty}</div>
                <button class="btn-remove" onclick="removeFromCart('${item.id}')">×</button>
            `;
            cartContainer.appendChild(el);
        });
        document.getElementById('btn-checkout').disabled = false;
    }

    document.getElementById('cart-total-price').textContent = `¥${total}`;
    updateChangeCalculation();
}

function updateChangeCalculation() {
    const total = currentCart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const tenderedInput = document.getElementById('cart-tendered-amount');
    const tendered = parseInt(tenderedInput.value);
    const changeAmountEl = document.getElementById('cart-change-amount');
    const btnCheckout = document.getElementById('btn-checkout');

    if (total === 0) {
        changeAmountEl.textContent = '¥0';
        changeAmountEl.style.color = 'var(--primary-pink)';
        btnCheckout.disabled = true;
        return;
    }

    if (isNaN(tendered) || tenderedInput.value === '') {
        // お預かり金額が未入力の場合はぴったりもらった想定
        changeAmountEl.textContent = '¥0';
        changeAmountEl.style.color = 'var(--primary-pink)';
        btnCheckout.disabled = false;
        return;
    }

    const change = tendered - total;

    if (change < 0) {
        changeAmountEl.textContent = '不足 ¥' + Math.abs(change);
        changeAmountEl.style.color = '#ff8a80';
        btnCheckout.disabled = true;
    } else {
        changeAmountEl.textContent = '¥' + change;
        changeAmountEl.style.color = 'var(--primary-pink)';
        btnCheckout.disabled = false;
    }
}

function updateTodaySales() {
    const total = state.sales.reduce((sum, sale) => sum + sale.total, 0);
    const el = document.getElementById('today-sales-total');
    if (el) el.textContent = `¥${total.toLocaleString()}`;
}

// --- 番号チェック & カウンター連携 ---
function handleNumberCheck() {
    const slotId = document.getElementById('pos-slot-select').value;
    const numInput = document.getElementById('pos-check-number');
    const inputVal = numInput.value.trim();

    if (!inputVal) return;

    // 「001」や「1」などの入力に対して、現在の時間帯のプレフィックス（例：①-）を自動で補う
    const formattedInput = inputVal.padStart(3, '0'); // "1" -> "001"
    const prefix = slots[slotId] && slots[slotId].prefix ? `${slots[slotId].prefix}-` : "";
    const searchObjNumber = prefix + formattedInput;

    // 1. 予約名簿から検索 (現在の時間帯のスロット内でのみ探すので、他の時間帯の人は絶対に出ない)
    const entry = state.entries.find(en =>
        en.slotId === slotId &&
        (en.number === inputVal || en.number === searchObjNumber || en.number.endsWith(formattedInput))
    );

    if (entry) {
        if (entry.status === 'checked-in') {
            alert(`整理番号 ${entry.number} は既に受付済みです。`);
        } else {
            // 受付済みにする (toggleCheckIn がカウンターを更新する)
            toggleCheckIn(entry.id);
            alert(`予約確認: ${entry.name} 様（${entry.number}）を「受付済」にしました✨`);
            updatePOSSuggestions(); // サジェストリストからも削除
        }
    } else {
        // 2. 名簿にない場合 (当日整理券など)
        if (!state.slotCounts[slotId]) state.slotCounts[slotId] = 0;
        state.slotCounts[slotId]++;
        saveData();
        updatePOSCounterDisplay();
        alert(`整理番号 ${inputVal} を当日分としてカウントしました(+1)✨`);
    }

    numInput.value = '';
    numInput.focus();
}

// --- テストデータ生成 ---
function generateTestData() {
    try {
        console.log("Generating enhanced test data...");
        const testNames = ["あきこ", "けんじ", "さくら", "ひろし", "ゆうき", "ななこ", "たくみ", "めぐみ", "かいと", "りな"];

        if (!Array.isArray(state.entries)) state.entries = [];

        // 全スロットに対して10名ずつ生成
        Object.keys(slots).forEach(slotId => {
            const countToGen = 10;

            for (let i = 0; i < countToGen; i++) {
                // そのスロットの最大の番号を探して+1する (プレフィックス対応)
                const existingInSlot = state.entries.filter(en => en.slotId === slotId);
                let maxNum = 0;
                existingInSlot.forEach(en => {
                    // "①-001" のような形式から数字部分を取り出す
                    const parts = en.number.split('-');
                    const n = parseInt(parts.length > 1 ? parts[1] : parts[0], 10);
                    if (!isNaN(n) && n > maxNum) maxNum = n;
                });

                const nextNum = maxNum + 1;
                const formattedNum = String(nextNum).padStart(3, '0');
                const displayNum = slots[slotId].prefix ? `${slots[slotId].prefix}-${formattedNum}` : formattedNum;
                const randomName = testNames[Math.floor(Math.random() * testNames.length)];

                const entry = {
                    id: 'test_' + Date.now() + Math.random(),
                    slotId: slotId,
                    slotName: slots[slotId].name,
                    name: randomName + " (テスト)",
                    phone: `090-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`,
                    number: displayNum,
                    status: Math.random() > 0.7 ? 'checked-in' : 'pending', // 30%の確率で受付済
                    timestamp: new Date().toLocaleString()
                };

                // 整理番号受付は予約ステータスのみ管理（slotCountsは当日受付専用にする）
                state.entries.push(entry);
            }
        });

        saveData();
        populateSlotSelects();
        updateReceptionList();
        updatePOSCounterDisplay(); // カウンターも同期
        alert("全時間帯のテストデータを生成しました✨\n「名簿管理」でタブを切り替えて確認できます。");
    } catch (err) {
        console.error("Generate error:", err);
        alert("エラーが発生しました: " + err.message);
    }
}

function generateTestProducts() {
    try {
        console.log("Generating test products...");
        const tests = [
            { id: 'test_prod_1', name: '✨ キラシール (レア)', price: 100, image: "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%23fff9c4'/%3E%3Ctext x='50%25' y='50%25' font-size='40' text-anchor='middle' dy='.3em'%3E✨%3C/text%3E%3C/svg%3E" },
            { id: 'test_prod_2', name: '🌸 お花シール', price: 50, image: "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%23fce4ec'/%3E%3Ctext x='50%25' y='50%25' font-size='40' text-anchor='middle' dy='.3em'%3E🌸%3C/text%3E%3C/svg%3E" },
            { id: 'test_prod_3', name: '🐶 わんこシール', price: 50, image: "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%23efebe9'/%3E%3Ctext x='50%25' y='50%25' font-size='40' text-anchor='middle' dy='.3em'%3E🐶%3C/text%3E%3C/svg%3E" },
            { id: 'test_prod_4', name: '⭐ お星さまシール', price: 50, image: "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%23fff3e0'/%3E%3Ctext x='50%25' y='50%25' font-size='40' text-anchor='middle' dy='.3em'%3E⭐%3C/text%3E%3C/svg%3E" },
            { id: 'test_prod_5', name: '🌈 レインボーセット', price: 300, image: "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%23e1f5fe'/%3E%3Ctext x='50%25' y='50%25' font-size='40' text-anchor='middle' dy='.3em'%3E🌈%3C/text%3E%3C/svg%3E" }
        ];

        // 既存の商品を消さずに、IDが重複しないものだけ追加する
        if (!Array.isArray(state.products)) state.products = [];
        const existingIds = new Set(state.products.map(p => p.id));

        tests.forEach(t => {
            if (!existingIds.has(t.id)) {
                state.products.push(t);
            }
        });

        saveData();
        updateAdminProductList();
        refreshPOS();

        alert("テスト用の商品を5個追加しました！✨\n（自分で登録した商品はそのまま残っています）");
    } catch (err) {
        console.error("Generate products error:", err);
        alert("エラーが発生しました: " + err.message);
    }
}


// --- 名簿検索 & フィルター (Reception) ---
function updateReceptionFilters() {
    const filterContainer = document.getElementById('slot-filters');
    if (!filterContainer) return;

    filterContainer.innerHTML = '';

    // 「全て」ボタン
    const allBtn = document.createElement('button');
    allBtn.textContent = '全て';
    allBtn.className = `filter-btn ${state.currentSlotFilter === 'all' ? 'active' : ''}`;
    allBtn.onclick = () => {
        state.currentSlotFilter = 'all';
        updateReceptionFilters();
        updateReceptionList();
    };
    filterContainer.appendChild(allBtn);

    // 各スロットのボタン
    Object.keys(slots).forEach(slotId => {
        const btn = document.createElement('button');
        btn.textContent = slots[slotId].name;
        // 色分けクラスを付与
        btn.className = `filter-btn slot-color-${slotId} ${state.currentSlotFilter === slotId ? 'active' : ''}`;
        btn.onclick = () => {
            state.currentSlotFilter = slotId;
            updateReceptionFilters();
            updateReceptionList();
        };
        filterContainer.appendChild(btn);
    });
}

function updateSearchResultCount(count, searchVal) {
    let countEl = document.getElementById('search-result-count');
    const controls = document.querySelector('.reception-controls');

    if (!countEl && controls) {
        countEl = document.createElement('div');
        countEl.id = 'search-result-count';
        countEl.className = 'search-result-count';
        controls.appendChild(countEl);
    }

    if (!countEl) return;

    if (searchVal.trim() === "") {
        countEl.textContent = "";
        countEl.style.display = 'none';
    } else {
        countEl.textContent = `✨ ${count}件 見つかりました`;
        countEl.style.display = 'block';
    }
}

function updateReceptionList() {
    const listBody = document.getElementById('reception-list-body');
    const searchInput = document.getElementById('search-input');
    const searchVal = searchInput.value.toLowerCase();

    // 検索中表示の制御
    if (searchVal.trim() !== "") {
        searchInput.classList.add('searching-active');
    } else {
        searchInput.classList.remove('searching-active');
    }

    updateReceptionFilters(); // フィルターUIも同期
    listBody.innerHTML = '';

    if (!Array.isArray(state.entries) || state.entries.length === 0) {
        listBody.innerHTML = '<tr><td colspan="6" class="placeholder-text" style="text-align:center;">データがありません</td></tr>';
        return;
    }

    // ソート
    const sortedEntries = [...state.entries].sort((a, b) => {
        if (a.slotId !== b.slotId) return a.slotId.localeCompare(b.slotId);
        return a.number.localeCompare(b.number);
    });

    // フィルター (スロット + 検索ワード + 受付済かどうか)
    const hideCheckedIn = document.getElementById('filter-hide-checked-in') ? document.getElementById('filter-hide-checked-in').checked : false;

    const filtered = sortedEntries.filter(en => {
        // 検索ワードがある場合はスロットフィルターを無視して全件から探す
        const isSearching = searchVal.trim() !== "";
        const matchesSlot = (isSearching || state.currentSlotFilter === 'all') || en.slotId === state.currentSlotFilter;

        // 時間帯の文字列（例：10:00〜11:00）でも検索できるように
        const searchTargetStr = `${en.name} ${en.phone || ''} ${en.number} ${en.slotName}`.toLowerCase();
        const matchesSearch = searchTargetStr.includes(searchVal);
        const matchesHideFilter = hideCheckedIn ? (en.status !== 'checked-in') : true;

        return matchesSlot && matchesSearch && matchesHideFilter;
    });

    if (filtered.length === 0) {
        listBody.innerHTML = '<tr><td colspan="6" class="placeholder-text" style="text-align:center;">見つかりませんでした</td></tr>';
        updateSearchResultCount(0, searchVal);
        return;
    }

    updateSearchResultCount(filtered.length, searchVal);

    filtered.forEach(entry => {
        const tr = document.createElement('tr');
        // 時間帯ごとに色分けクラスを付与
        if (entry.slotId) {
            tr.classList.add(`slot-row-${entry.slotId}`);
        }
        if (entry.status === 'checked-in') {
            tr.classList.add('checked-in');
            // 受付済み行でも時間帯の色が薄く見えるように
        }

        const statusLabel = entry.status === 'checked-in' ? '<span class="status-badge status-checked">受付済</span>' : '<span class="status-badge status-pending">未受付</span>';

        tr.innerHTML = `
            <td>${entry.slotName}</td>
            <td>${entry.number}</td>
            <td><strong>${entry.name}</strong></td>
            <td>${entry.phone}</td>
            <td>
                <div style="display:flex; gap:5px; align-items:center;">
                    <button class="btn-checkin-sm" style="background:${entry.status === 'checked-in' ? '#ccc' : 'var(--primary-pink)'}; color:${entry.status === 'checked-in' ? '#fff' : '#ff80ab'}">
                        ${entry.status === 'checked-in' ? '取消' : '受付'}
                    </button>
                    <button class="btn-delete-entry" data-id="${entry.id}" style="background:none; border:none; color:#f44336; cursor:pointer; font-size:1.2rem; margin-left:10px;" title="名簿から削除">
                        🗑️
                    </button>
                </div>
            </td>
            <td>${statusLabel}</td>
        `;
        tr.querySelector('.btn-checkin-sm').addEventListener('click', () => toggleCheckIn(entry.id));
        tr.querySelector('.btn-delete-entry').addEventListener('click', (e) => {
            deleteEntry(e.currentTarget.getAttribute('data-id'));
        });
        listBody.appendChild(tr);
    });
}

function deleteEntry(id) {
    if (confirm("本当にこの予約をキャンセル（名簿から削除）しますか？")) {
        const idx = state.entries.findIndex(e => e.id === id);
        if (idx !== -1) {
            const entry = state.entries[idx];
            // 受付済みの場合はカウントを減らす
            if (entry.status === 'checked-in' && state.slotCounts[entry.slotId] > 0) {
                state.slotCounts[entry.slotId]--;
            }
            state.entries.splice(idx, 1);
            saveData();
            updateReceptionList();
            updatePOSCounterDisplay();
        }
    }
}

function toggleCheckIn(id) {
    const entry = state.entries.find(e => e.id === id);
    if (entry) {
        const slotId = entry.slotId;
        if (!state.slotCounts[slotId]) state.slotCounts[slotId] = 0;

        if (entry.status === 'checked-in') {
            entry.status = 'pending';
        } else {
            entry.status = 'checked-in';
        }
        saveData();
        updateReceptionList();
        updatePOSCounterDisplay();
    }
}


// --- CSV Exports ---
function exportCSV() {
    if (!Array.isArray(state.entries) || state.entries.length === 0) {
        alert("名簿データがありません");
        return;
    }
    // Excelで開いたときに文字化けしないための魔法のコード (\uFEFF)
    let csv = "\uFEFFスロット,整理番号,お名前,電話番号,予約状態,登録日時\n";
    state.entries.forEach(en => {
        const jStatus = en.status === 'checked-in' ? '受付済' : '未受付';
        csv += `"${en.slotName}","${en.number}","${en.name}","${en.phone}","${jStatus}","${en.timestamp}"\n`;
    });
    downloadBlob(csv, `名簿一覧_${new Date().toLocaleDateString('ja-JP').replace(/\//g, '-')}.csv`);
}

function exportSalesCSV() {
    if (state.sales.length === 0) {
        alert("売上データがありません");
        return;
    }
    let csv = "\uFEFF取引ID,日時,合計金額,購入内容\n";
    state.sales.forEach(s => {
        const itemsStr = s.items.map(i => `${i.name}x${i.qty}`).join(" / ");
        csv += `"${s.id}","${s.timestamp}",${s.total},"${itemsStr}"\n`;
    });
    downloadBlob(csv, `売上ログ_${new Date().toLocaleDateString()}.csv`);
}

function downloadBlob(csvContent, filename) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/**
 * 名簿データ(entries)から各スロットの受付済み人数を正確に再計算する
 */
function recalculateSlotCounts() {
    // 一旦リセット
    state.slotCounts = {};
    Object.keys(slots).forEach(sid => state.slotCounts[sid] = 0);

    // 受付済みの人をカウント
    if (Array.isArray(state.entries)) {
        state.entries.forEach(en => {
            if (en.status === 'checked-in') {
                if (!state.slotCounts[en.slotId]) state.slotCounts[en.slotId] = 0;
                state.slotCounts[en.slotId]++;
            }
        });
    }
}

// --- テスト商品生成 (保存容量を節約するため少なめに) ---
function generateTestProducts() {
    const testDescs = [
        { name: "キラキラシール", price: 300, color1: "#FF7043", color2: "#FFCCBC" },
        { name: "お花セット", price: 500, color1: "#66BB6A", color2: "#C8E6C9" },
        { name: "ワンちゃん", price: 200, color1: "#42A5F5", color2: "#BBDEFB" },
        { name: "ねこさん", price: 250, color1: "#AB47BC", color2: "#E1BEEF" }
    ];

    testDescs.forEach(d => {
        const svg = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><rect width='100' height='100' fill='${encodeURIComponent(d.color1)}'/><circle cx='50' cy='50' r='30' fill='${encodeURIComponent(d.color2)}'/></svg>`;
        state.products.push({
            id: 'prod_' + Math.random().toString(36).substr(2, 9),
            name: d.name,
            price: d.price,
            image: svg
        });
    });

    saveData();
    updateAdminProductList();
    if (typeof refreshPOS === 'function') refreshPOS();
    alert("テスト商品を4件追加しました✨");
}

function generateQRCode(container, text) {
    if (typeof QRCode === 'undefined') {
        console.error("QRCode library is not loaded.");
        container.innerHTML = '<p style="color:#888; font-size:0.8rem;">(QR作成失敗)</p>';
        return;
    }
    container.innerHTML = '';
    try {
        new QRCode(container, {
            text: encodeURI(text),
            width: 170, // 少し大きく
            height: 170,
            colorDark: "#ff80ab",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.M // HからMに下げて情報密度を緩和
        });
    } catch (e) {
        console.error("QR Render failed:", e);
        container.innerHTML = `<p style="color:#888; font-size:0.8rem;">QRエラー: ${text}</p>`;
    }
}

/**
 * 画面上の「時間帯別 当日受付数」テーブルを更新する
 */
function updateSlotSummary() {
    const tbody = document.getElementById('slot-reception-summary-tbody');
    const totalSumEl = document.getElementById('slot-reception-total-sum');
    if (!tbody) return;

    tbody.innerHTML = '';
    let totalAllSlots = 0;

    Object.keys(slots).forEach(slotId => {
        const count = state.slotCounts[slotId] || 0;
        totalAllSlots += count;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${slots[slotId].name}</td>
            <td style="text-align: center; font-weight: bold; color: var(--primary-purple);">${count}</td>
        `;
        tbody.appendChild(tr);
    });

    if (totalSumEl) totalSumEl.textContent = totalAllSlots;
}
