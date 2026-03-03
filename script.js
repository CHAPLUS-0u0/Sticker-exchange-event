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
        adminPassword: "admin"
    }
};

let isAdminAuth = sessionStorage.getItem('sticker_admin_auth') === 'true';
let currentCart = [];

const slots = {
    slot1: { name: "10:00–10:30", type: "pre" },
    slot2: { name: "10:45–11:15", type: "pre" },
    slot3: { name: "11:30–12:00", type: "walk-in" },
    slot4: { name: "12:15–12:45", type: "pre" },
    slot5: { name: "13:00–13:30", type: "pre" },
    slot6: { name: "13:45–14:15", type: "walk-in" },
    slot7: { name: "14:30–15:00", type: "walk-in" }
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    checkAccess();
    initApp();
});

function loadData() {
    const saved = localStorage.getItem('sticker_exchange_data');
    if (saved) {
        const parsed = JSON.parse(saved);
        state = {
            ...state,
            ...parsed,
            entries: parsed.entries || [],
            products: parsed.products || [],
            sales: parsed.sales || [],
            slotCounts: parsed.slotCounts || {},
            settings: { ...state.settings, ...(parsed.settings || {}) }
        };
    }
}

function saveData() {
    localStorage.setItem('sticker_exchange_data', JSON.stringify(state));
    updateTodaySales();
}

// アクセス制御
function checkAccess() {
    const urlParams = new URLSearchParams(window.location.search);
    const isFormView = urlParams.get('view') === 'form';

    if (isFormView) {
        // 一般公開フォームモード
        document.getElementById('login-modal').classList.add('hidden');
        document.getElementById('main-nav').classList.add('hidden');
        switchView(null, 'registration-view');
    } else {
        // 管理者モード
        if (isAdminAuth) {
            document.getElementById('login-modal').classList.add('hidden');
            document.getElementById('main-nav').classList.remove('hidden');
            switchView(document.querySelector('[data-target="pos-view"]'), 'pos-view');
        } else {
            document.getElementById('login-modal').classList.remove('hidden');
            document.getElementById('main-nav').classList.add('hidden');
        }
    }
}

function initApp() {
    // ---- ログイン ----
    document.getElementById('btn-login').addEventListener('click', () => {
        const pw = document.getElementById('login-password').value;
        if (pw === state.settings.adminPassword || pw === 'admin') {
            isAdminAuth = true;
            sessionStorage.setItem('sticker_admin_auth', 'true');
            checkAccess();
        } else {
            alert("パスワードが違います😢");
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
    document.getElementById('btn-save-settings').addEventListener('click', () => {
        state.settings.eventName = document.getElementById('setting-event-name').value;
        state.settings.eventDate = document.getElementById('setting-event-date').value;
        state.settings.hpUrl = document.getElementById('setting-hp-url').value;
        saveData();
        updateSettingsUI();
        alert("設定を保存しました✨");
    });
    document.getElementById('btn-clear-all').addEventListener('click', () => {
        if (confirm("本当に全てのデータを削除しますか？ (リセット)")) {
            state.entries = [];
            state.products = [];
            state.sales = [];
            state.slotCounts = {};
            saveData();
            location.reload();
        }
    });

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
    document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
    document.getElementById('btn-export-reception-csv').addEventListener('click', exportCSV);
    document.getElementById('btn-export-sales-csv').addEventListener('click', exportSalesCSV);
    document.getElementById('btn-generate-test').addEventListener('click', generateTestData);

    // ---- 商品管理タブ ----
    initProductAdmin();

    // ---- POS（レジ）タブ ----
    initPOS();

    // ---- 番号チェック連携 ----
    document.getElementById('btn-pos-check-number').addEventListener('click', handleNumberCheck);
}

function updateSettingsUI() {
    document.getElementById('app-title-display').textContent = `🎀 ${state.settings.eventName} 🎀`;
    document.getElementById('event-date-display').textContent = `📅 開催日: ${state.settings.eventDate}`;
    document.getElementById('setting-event-name').value = state.settings.eventName;
    document.getElementById('setting-event-date').value = state.settings.eventDate;
    document.getElementById('setting-hp-url').value = state.settings.hpUrl || "";

    // フッターのHPリンク更新
    const footerHp = document.getElementById('footer-hp-link');
    if (state.settings.hpUrl) {
        footerHp.innerHTML = `<a href="${state.settings.hpUrl}" target="_blank" class="hp-link">🏠 ホームページはこちら</a>`;
    } else {
        footerHp.innerHTML = "";
    }

    updateTodaySales();

    // 公開URLの生成と表示
    const currentUrl = new URL(window.location.href);
    currentUrl.search = '?view=form';
    document.getElementById('public-form-url').href = currentUrl.href;
    document.getElementById('public-form-url').textContent = currentUrl.href;
}

// 画面切り替え
function switchView(btn, targetId) {
    if (btn) {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(targetId).classList.add('active');

    if (targetId === 'reception-view') updateReceptionList();
    if (targetId === 'pos-view') refreshPOS();
    if (targetId === 'product-admin-view') updateAdminProductList();
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

    const newEntry = {
        id: Date.now().toString(),
        slotId: selectedSlotId,
        slotName: slots[selectedSlotId].name,
        name: userName,
        phone: userPhone,
        number: formattedNum,
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

    imgInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function (event) {
                pendingImageBase64 = event.target.result;
                imgPreview.src = pendingImageBase64;
                imgPreview.style.display = 'block';
            };
            reader.readAsDataURL(file);
        }
    });

    document.getElementById('btn-add-product').addEventListener('click', () => {
        const id = document.getElementById('prod-id-editing').value;
        const name = document.getElementById('prod-name').value.trim();
        const price = parseInt(document.getElementById('prod-price').value);

        if (!name || isNaN(price)) {
            alert("商品名と値段を正しく入力してください");
            return;
        }

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
            document.getElementById('btn-add-product').textContent = "商品を追加 / 更新";
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
        alert(id ? "商品を更新しました✨" : "商品を追加しました✨");
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

        const imgSrc = p.image ? p.image : 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect width="50" height="50" fill="%23eee"/></svg>';

        item.innerHTML = `
            <img src="${imgSrc}" alt="${p.name}">
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

    // カートクリア
    document.getElementById('btn-cart-clear').addEventListener('click', () => {
        currentCart = [];
        updateCartUI();
    });

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

        currentCart = [];
        updateCartUI();
        alert(`会計完了しました！\n合計: ¥${total}`);
    });
}

function refreshPOS() {
    updatePOSCounterDisplay();

    // 商品グリッドの描画
    const grid = document.getElementById('product-grid');
    grid.innerHTML = '';

    if (state.products.length === 0) {
        grid.innerHTML = '<p class="placeholder-text" style="grid-column: 1/-1;">商品が登録されていません。<br>「商品管理」から追加してください。</p>';
    } else {
        state.products.forEach(p => {
            const tile = document.createElement('div');
            tile.className = 'product-tile';
            const imgSrc = p.image ? p.image : 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="%23eee"/></svg>';

            tile.innerHTML = `
                <img src="${imgSrc}" loading="lazy">
                <div class="name">${p.name}</div>
                <div class="price">¥${p.price}</div>
            `;

            tile.addEventListener('click', () => addToCart(p));
            grid.appendChild(tile);
        });
    }

    updateCartUI();
}

function updatePOSCounterDisplay() {
    const slotId = document.getElementById('pos-slot-select').value;
    if (!slotId) return;

    document.getElementById('pos-current-slot-name').textContent = slots[slotId].name;
    const count = state.slotCounts[slotId] || 0;
    document.getElementById('pos-slot-count').textContent = count;
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

    // 1. 予約名簿から検索 (現在のスロット)
    const entry = state.entries.find(en => en.slotId === slotId && en.number === inputVal);

    if (entry) {
        if (entry.status === 'checked-in') {
            alert(`整理番号 ${inputVal} は既に受付済みです。`);
        } else {
            // 受付済みにする (toggleCheckIn がカウンターを更新する)
            toggleCheckIn(entry.id);
            alert(`予約確認: ${entry.name} 様を「受付済」にしました✨`);
        }
    } else {
        // 2. 名簿にない場合 (当日整理券など)
        if (!state.slotCounts[slotId]) state.slotCounts[slotId] = 0;
        state.slotCounts[slotId]++;
        saveData();
        updatePOSCounterDisplay();
        alert(`整理番号 ${inputVal} をカウントしました(+1)✨`);
    }

    numInput.value = '';
    numInput.focus();
}

// --- テストデータ生成 ---
function generateTestData() {
    try {
        console.log("Generating test data...");
        const testNames = ["あきこ", "けんじ", "さくら", "ひろし", "ゆうき", "ななこ", "たくみ", "めぐみ", "かいと", "りな"];
        const testSlots = ["slot1", "slot2", "slot4", "slot5"]; // 予約可能なスロット

        // state.entries が何らかの理由で壊れていた場合のガード
        if (!Array.isArray(state.entries)) {
            state.entries = [];
        }

        if (state.entries.length > 50) {
            alert("すでに十分なデータがあります。");
            return;
        }

        testNames.forEach((name, i) => {
            const slotId = testSlots[i % testSlots.length];
            const countInSlot = state.entries.filter(en => en.slotId === slotId).length;
            const nextNum = countInSlot + 1;
            const formattedNum = String(nextNum).padStart(3, '0');

            const entry = {
                id: 'test_' + Date.now() + i,
                slotId: slotId,
                slotName: slots[slotId].name,
                name: name + " (テスト)",
                phone: `090-0000-${String(i).padStart(4, '0')}`,
                number: formattedNum,
                status: 'pending',
                timestamp: new Date().toLocaleString()
            };
            state.entries.push(entry);
        });

        saveData();
        populateSlotSelects();
        updateReceptionList();
        alert("テストデータを10名分生成しました✨\n「名簿管理」タブで確認できます。");
    } catch (err) {
        console.error("Generate error:", err);
        alert("エラーが発生しました: " + err.message);
    }
}


// --- 名簿検索 (Reception) ---
function updateReceptionList() {
    const listBody = document.getElementById('reception-list-body');
    const searchVal = document.getElementById('search-input').value.toLowerCase();

    listBody.innerHTML = '';

    if (!Array.isArray(state.entries) || state.entries.length === 0) {
        listBody.innerHTML = '<tr><td colspan="6" class="placeholder-text" style="text-align:center;">データがありません</td></tr>';
        return;
    }

    const sortedEntries = [...state.entries].sort((a, b) => {
        if (a.slotId !== b.slotId) return a.slotId.localeCompare(b.slotId);
        return a.number.localeCompare(b.number);
    });

    const filtered = sortedEntries.filter(en =>
        en.name.toLowerCase().includes(searchVal) ||
        (en.phone && en.phone.includes(searchVal)) ||
        en.number.includes(searchVal) ||
        en.slotName.includes(searchVal)
    );

    if (filtered.length === 0) {
        listBody.innerHTML = '<tr><td colspan="6" class="placeholder-text" style="text-align:center;">見つかりませんでした</td></tr>';
        return;
    }

    filtered.forEach(entry => {
        const tr = document.createElement('tr');
        if (entry.status === 'checked-in') tr.className = 'checked-in';

        const statusLabel = entry.status === 'checked-in' ? '<span class="status-badge status-checked">受付済</span>' : '<span class="status-badge status-pending">未受付</span>';

        tr.innerHTML = `
            <td>${entry.slotName}</td>
            <td>${entry.number}</td>
            <td><strong>${entry.name}</strong></td>
            <td>${entry.phone}</td>
            <td>
                <button class="btn-checkin-sm" style="background:${entry.status === 'checked-in' ? '#ccc' : 'var(--primary-pink)'}; color:${entry.status === 'checked-in' ? '#fff' : '#ff80ab'}">
                    ${entry.status === 'checked-in' ? '取消' : '受付'}
                </button>
            </td>
            <td>${statusLabel}</td>
        `;
        tr.querySelector('.btn-checkin-sm').addEventListener('click', () => toggleCheckIn(entry.id));
        listBody.appendChild(tr);
    });
}

function toggleCheckIn(id) {
    const entry = state.entries.find(e => e.id === id);
    if (entry) {
        const slotId = entry.slotId;
        if (!state.slotCounts[slotId]) state.slotCounts[slotId] = 0;

        if (entry.status === 'checked-in') {
            entry.status = 'pending';
            if (state.slotCounts[slotId] > 0) state.slotCounts[slotId]--;
        } else {
            entry.status = 'checked-in';
            state.slotCounts[slotId]++;
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
