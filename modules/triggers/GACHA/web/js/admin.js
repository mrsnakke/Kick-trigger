/* ─── Toast system ─── */
function toast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container')
  const el = document.createElement('div')
  el.className = `toast toast-${type}`
  el.textContent = message
  container.appendChild(el)
  setTimeout(() => {
    el.classList.add('toast-removing')
    el.addEventListener('animationend', () => el.remove())
  }, duration)
}

/* ─── Confirm modal ─── */
function confirmDialog(message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal')
    const msgEl = document.getElementById('confirm-message')
    const okBtn = document.getElementById('confirm-ok')
    const cancelBtn = document.getElementById('confirm-cancel')
    msgEl.textContent = message
    modal.classList.remove('hidden')
    const close = (result) => { modal.classList.add('hidden'); resolve(result) }
    okBtn.onclick = () => close(true)
    cancelBtn.onclick = () => close(false)
    modal.querySelector('.modal-backdrop').onclick = () => close(false)
  })
}

/* ─── Sidebar ─── */
const sidebar = document.getElementById('sidebar')
document.getElementById('sidebar-toggle').addEventListener('click', () => {
  sidebar.classList.toggle('collapsed')
})
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'))
    document.getElementById(`panel-${btn.dataset.panel}`).classList.add('active')
  })
})

/* ─── API helpers ─── */
async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

/* ─── Characters ─── */
const charNameInput = document.getElementById('character-name')
const charRaritySelect = document.getElementById('character-rarity')
const charBannerSelect = document.getElementById('character-banner')
const charStockInput = document.getElementById('character-stock')
const charImageInput = document.getElementById('character-image')
const imagePreview = document.getElementById('image-preview')
const imageDropzone = document.getElementById('image-dropzone')
const stockFieldGroup = document.getElementById('stock-field-group')
const charFormCard = document.getElementById('character-form-card')
const charFormTitle = document.getElementById('character-form-title')
const charForm = document.getElementById('character-form')
const charSearch = document.getElementById('char-search')
const charTbody = document.getElementById('characters-tbody')
const charLoading = document.getElementById('characters-loading')
const charEmpty = document.getElementById('characters-empty')
const charTableContainer = document.getElementById('characters-table-container')
const charTabs = document.getElementById('char-tabs')

let editingCharacter = null
let charactersData = null
let charSortField = null
let charSortDir = 'asc'
let charFilter = 'all'

function toggleStockVisibility() {
  const rarity = charRaritySelect.value
  const banner = charBannerSelect.value
  stockFieldGroup.style.display = (rarity === '5_star' || rarity === '6_star') && banner === 'seasonal_banner' ? 'block' : 'none'
  if (stockFieldGroup.style.display === 'none') charStockInput.value = 0
}
charRaritySelect.addEventListener('change', toggleStockVisibility)
charBannerSelect.addEventListener('change', toggleStockVisibility)

/* Image dropzone */
imageDropzone.addEventListener('click', () => charImageInput.click())
imageDropzone.addEventListener('dragover', (e) => { e.preventDefault(); imageDropzone.classList.add('dragover') })
imageDropzone.addEventListener('dragleave', () => imageDropzone.classList.remove('dragover'))
imageDropzone.addEventListener('drop', (e) => {
  e.preventDefault(); imageDropzone.classList.remove('dragover')
  if (e.dataTransfer.files.length) {
    charImageInput.files = e.dataTransfer.files
    showPreview(e.dataTransfer.files[0])
  }
})
charImageInput.addEventListener('change', () => {
  if (charImageInput.files[0]) showPreview(charImageInput.files[0])
})
function showPreview(file) {
  const reader = new FileReader()
  reader.onload = (e) => {
    imagePreview.src = e.target.result; imagePreview.style.display = 'block'
    imageDropzone.querySelector('.dropzone-content').style.display = 'none'
  }
  reader.readAsDataURL(file)
}
function resetImagePreview() {
  imagePreview.src = ''; imagePreview.style.display = 'none'
  imageDropzone.querySelector('.dropzone-content').style.display = 'flex'
  charImageInput.value = ''
}

document.getElementById('btn-new-character').addEventListener('click', () => {
  editingCharacter = null
  charFormTitle.textContent = 'Añadir Personaje'
  document.getElementById('btn-submit-form').textContent = 'Guardar'
  charForm.reset()
  resetImagePreview()
  stockFieldGroup.style.display = 'none'
  charFormCard.classList.remove('hidden')
  charFormCard.scrollIntoView({ behavior: 'smooth', block: 'center' })
})
document.getElementById('btn-cancel-form').addEventListener('click', () => {
  charFormCard.classList.add('hidden')
  editingCharacter = null
})

charForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  const name = charNameInput.value.trim()
  const rarity = charRaritySelect.value
  const banner = charBannerSelect.value
  if (!name || !rarity || !banner) { toast('Completa todos los campos obligatorios.', 'error'); return }

  const formData = new FormData()
  formData.append('name', name)
  formData.append('rarity', rarity)
  formData.append('banner', banner)
  if (charImageInput.files[0]) formData.append('image', charImageInput.files[0])
  if (stockFieldGroup.style.display !== 'none') formData.append('stock', charStockInput.value)

  const url = editingCharacter ? `/gacha/admin/character/${encodeURIComponent(editingCharacter)}` : '/gacha/admin/character'
  const method = editingCharacter ? 'PUT' : 'POST'

  try {
    const res = await fetch(url, { method, body: formData })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error || 'Error')
    toast(result.message, 'success')
    charFormCard.classList.add('hidden')
    charForm.reset()
    resetImagePreview()
    stockFieldGroup.style.display = 'none'
    editingCharacter = null
    loadCharacters()
  } catch (err) { toast(err.message, 'error') }
})

async function loadCharacters() {
  charLoading.classList.remove('hidden')
  charTableContainer.style.display = 'none'
  charEmpty.classList.add('hidden')
  try {
    const data = await api('/gacha/admin/characters')
    charactersData = data
    renderCharacters()
  } catch (err) { toast('Error al cargar personajes.', 'error') }
  charLoading.classList.add('hidden')
}

function renderCharacters() {
  if (!charactersData) return
  const { standard_banner, seasonal_banner, character_details } = charactersData
  const all = {}
  for (const [rarity, names] of Object.entries(standard_banner)) {
    for (const name of names) {
      const d = character_details[name] || {}
      all[name] = { name, rarity, banner: 'standard_banner', stock: d.stock, image_url: d.image_url || '' }
    }
  }
  for (const [rarity, names] of Object.entries(seasonal_banner)) {
    for (const name of names) {
      const d = character_details[name] || {}
      all[name] = { name, rarity, banner: 'seasonal_banner', stock: d.stock, image_url: d.image_url || '' }
    }
  }

  let list = Object.values(all)
  const searchTerm = charSearch.value.toLowerCase()
  if (searchTerm) list = list.filter(c => c.name.toLowerCase().includes(searchTerm))
  if (charFilter !== 'all') list = list.filter(c => c.banner === charFilter)

  if (charSortField) {
    list.sort((a, b) => {
      let va = a[charSortField], vb = b[charSortField]
      if (typeof va === 'string') va = va.toLowerCase()
      if (typeof vb === 'string') vb = vb.toLowerCase()
      if (va < vb) return charSortDir === 'asc' ? -1 : 1
      if (va > vb) return charSortDir === 'asc' ? 1 : -1
      return 0
    })
  }

  if (list.length === 0) {
    charTableContainer.style.display = 'none'
    charEmpty.classList.remove('hidden')
    return
  }
  charTableContainer.style.display = 'block'
  charEmpty.classList.add('hidden')

  charTbody.innerHTML = list.map(c => {
    const rarityNum = c.rarity ? c.rarity.replace('_star', '') : '?'
    const stockLabel = c.stock !== undefined ? c.stock : '∞'
    const bannerLabel = c.banner === 'standard_banner' ? 'Estándar' : 'Temporada'
    return `<tr>
      <td>${c.image_url ? `<img src="${c.image_url}" alt="" class="char-thumb">` : ''}</td>
      <td><strong>${c.name}</strong></td>
      <td><span class="rarity-badge rarity-${rarityNum}">${rarityNum}★</span></td>
      <td><span class="banner-badge">${bannerLabel}</span></td>
      <td>${stockLabel}</td>
      <td class="actions-cell">
        <button class="btn btn-sm btn-edit" data-name="${c.name}">✎</button>
        <button class="btn btn-sm btn-danger btn-delete" data-name="${c.name}">✕</button>
      </td>
    </tr>`
  }).join('')

  charTbody.querySelectorAll('.btn-edit').forEach(b => b.addEventListener('click', () => editCharacter(b.dataset.name)))
  charTbody.querySelectorAll('.btn-delete').forEach(b => b.addEventListener('click', () => deleteCharacter(b.dataset.name)))
}

async function editCharacter(name) {
  try {
    const d = await api(`/gacha/admin/character-details/${encodeURIComponent(name)}`)
    charNameInput.value = d.name
    charRaritySelect.value = d.rarity
    charBannerSelect.value = d.banner
    if (d.image_url) { imagePreview.src = d.image_url; imagePreview.style.display = 'block'; imageDropzone.querySelector('.dropzone-content').style.display = 'none' }
    if ((d.rarity === '5_star' || d.rarity === '6_star') && d.banner === 'seasonal_banner') {
      charStockInput.value = d.stock !== undefined ? d.stock : 0
      stockFieldGroup.style.display = 'block'
    } else { stockFieldGroup.style.display = 'none'; charStockInput.value = 0 }
    editingCharacter = name
    charFormTitle.textContent = `Editar: ${name}`
    document.getElementById('btn-submit-form').textContent = 'Guardar Cambios'
    charFormCard.classList.remove('hidden')
    charFormCard.scrollIntoView({ behavior: 'smooth', block: 'center' })
  } catch (err) { toast('Error al cargar detalles.', 'error') }
}

async function deleteCharacter(name) {
  if (!await confirmDialog(`¿Eliminar a "${name}" permanentemente?`)) return
  try {
    const res = await fetch(`/gacha/admin/character/${encodeURIComponent(name)}`, { method: 'DELETE' })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error)
    toast(result.message, 'success')
    loadCharacters()
  } catch (err) { toast(err.message, 'error') }
}

charSearch.addEventListener('input', renderCharacters)

charTabs.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab')
  if (!tab) return
  charTabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
  tab.classList.add('active')
  charFilter = tab.dataset.filter
  renderCharacters()
})

charTbody.addEventListener('click', (e) => {
  const th = e.target.closest('th.sortable')
  if (!th) return
  const field = th.dataset.sort
  if (charSortField === field) charSortDir = charSortDir === 'asc' ? 'desc' : 'asc'
  else { charSortField = field; charSortDir = 'asc' }
  document.querySelectorAll('th.sortable').forEach(t => t.classList.remove('sorted-asc', 'sorted-desc'))
  th.classList.add(charSortDir === 'asc' ? 'sorted-asc' : 'sorted-desc')
  renderCharacters()
})
/* ponytail: table sort delegates to tbody click, th.sortable are inside thead */

document.getElementById('btn-empty-add').addEventListener('click', () => document.getElementById('btn-new-character').click())

/* ─── Gacha Config ─── */
const prob3 = document.getElementById('prob-3-star')
const prob4 = document.getElementById('prob-4-star')
const prob5 = document.getElementById('prob-5-star')
const prob6 = document.getElementById('prob-6-star')
const rarityProbBar = document.getElementById('rarity-prob-bar')
const rarityProbSum = document.getElementById('rarity-prob-sum')
const rarityForm = document.getElementById('rarity-form')

const probStd = document.getElementById('prob-standard-banner')
const probSea = document.getElementById('prob-seasonal-banner')
const bannerProbBar = document.getElementById('banner-prob-bar')
const bannerProbSum = document.getElementById('banner-prob-sum')
const bannerProbForm = document.getElementById('banner-prob-form')

const stocksContainer = document.getElementById('stocks-container')
const saveStocksBtn = document.getElementById('save-stocks-button')
const gachaLoading = document.getElementById('gacha-loading')
const gachaContent = document.getElementById('gacha-config-content')

function updateRarityProbBar() {
  const values = [parseFloat(prob3.value) || 0, parseFloat(prob4.value) || 0, parseFloat(prob5.value) || 0, parseFloat(prob6.value) || 0]
  const sum = values.reduce((a, b) => a + b, 0)
  rarityProbSum.textContent = `Suma: ${sum.toFixed(6)}`
  rarityProbSum.classList.toggle('invalid', Math.abs(sum - 1) > 0.0001)
  rarityProbBar.style.width = `${Math.min(sum * 100, 100)}%`
  rarityProbBar.className = 'prob-bar-fill' + (Math.abs(sum - 1) > 0.01 ? ' error' : Math.abs(sum - 1) > 0.0001 ? ' warn' : '')
}
[prob3, prob4, prob5, prob6].forEach(i => i.addEventListener('input', updateRarityProbBar))

function updateBannerProbBar() {
  const v1 = parseFloat(probStd.value) || 0
  const v2 = parseFloat(probSea.value) || 0
  const sum = v1 + v2
  bannerProbSum.textContent = `Suma: ${sum.toFixed(4)}`
  bannerProbSum.classList.toggle('invalid', Math.abs(sum - 1) > 0.0001)
  bannerProbBar.style.width = `${Math.min(sum * 100, 100)}%`
  bannerProbBar.className = 'prob-bar-fill' + (Math.abs(sum - 1) > 0.01 ? ' error' : Math.abs(sum - 1) > 0.0001 ? ' warn' : '')
}
[probStd, probSea].forEach(i => i.addEventListener('input', updateBannerProbBar))

rarityForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  const probs = { '3_star': parseFloat(prob3.value), '4_star': parseFloat(prob4.value), '5_star': parseFloat(prob5.value), '6_star': parseFloat(prob6.value) }
  const sum = Object.values(probs).reduce((a, b) => a + b, 0)
  if (Math.abs(sum - 1) > 0.0001) { toast('La suma debe ser 1.', 'error'); return }
  try {
    const r = await api('/gacha/admin/gacha-config/rarity-probabilities', { method: 'PUT', body: JSON.stringify(probs) })
    toast(r.message, 'success')
    loadGachaConfig()
  } catch (err) { toast(err.message, 'error') }
})

bannerProbForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  const probs = { 'standard_banner': parseFloat(probStd.value), 'seasonal_banner': parseFloat(probSea.value) }
  const sum = Object.values(probs).reduce((a, b) => a + b, 0)
  if (Math.abs(sum - 1) > 0.0001) { toast('La suma debe ser 1.', 'error'); return }
  try {
    const r = await api('/gacha/admin/gacha-config/banner-probabilities', { method: 'PUT', body: JSON.stringify(probs) })
    toast(r.message, 'success')
    loadGachaConfig()
  } catch (err) { toast(err.message, 'error') }
})

saveStocksBtn.addEventListener('click', async () => {
  const stocks = {}
  stocksContainer.querySelectorAll('input').forEach(i => { stocks[i.dataset.charName] = parseInt(i.value) })
  try {
    const r = await api('/gacha/admin/gacha-config/character-stocks', { method: 'PUT', body: JSON.stringify(stocks) })
    toast(r.message, 'success')
    loadGachaConfig()
  } catch (err) { toast(err.message, 'error') }
})

async function loadGachaConfig() {
  gachaLoading.classList.remove('hidden')
  gachaContent.style.display = 'none'
  try {
    const config = await api('/gacha/admin/gacha-config')
    const rp = config.gacha_rules.rarity_probabilities
    if (rp) {
      prob3.value = rp['3_star']; prob4.value = rp['4_star']; prob5.value = rp['5_star']; prob6.value = rp['6_star']
      updateRarityProbBar()
    }
    const bp = config.gacha_rules?.banner_selection_probabilities?.['4_star_and_above']
    if (bp) { probStd.value = bp.standard_banner ?? 0.6; probSea.value = bp.seasonal_banner ?? 0.4; updateBannerProbBar() }
    renderCharacterStocks(config.character_stocks)
  } catch (err) { toast('Error al cargar config.', 'error') }
  gachaLoading.classList.add('hidden')
  gachaContent.style.display = 'grid'
}

function renderCharacterStocks(stocks) {
  stocksContainer.innerHTML = ''
  if (!stocks || Object.keys(stocks).length === 0) { stocksContainer.innerHTML = '<p style="color:var(--text-dim)">Sin stocks configurados.</p>'; return }
  Object.entries(stocks).forEach(([name, stock]) => {
    const div = document.createElement('div')
    div.className = 'stock-item'
    div.innerHTML = `<label>${name}</label><input type="number" data-char-name="${name}" value="${stock}" min="0">`
    stocksContainer.appendChild(div)
  })
}

/* ─── Seasonal Characters ─── */
const seasonStart = document.getElementById('season-start')
const seasonEnd = document.getElementById('season-end')
const saveSeasonBtn = document.getElementById('save-season-duration')
const availSelect = document.getElementById('available-characters-select')
const seasonalStockInput = document.getElementById('seasonal-character-stock')
const addSeasonalBtn = document.getElementById('add-character-to-season')
const seasonalList = document.getElementById('seasonal-characters-list')

async function loadSeasonalConfig() {
  try {
    const c = await api('/gacha/admin/seasonal-characters-config')
    if (c.season_duration) {
      const parts = c.season_duration.split(/\s+to\s+/i)
      if (parts[0]) seasonStart.value = parts[0]
      if (parts[1]) seasonEnd.value = parts[1]
    }
    renderSeasonalCharacters(c.characters)
  } catch (err) { toast('Error al cargar temporada.', 'error') }
}

function parseSeasonDuration() {
  const s = seasonStart.value, e = seasonEnd.value
  return s && e ? `${s} to ${e}` : ''
}

saveSeasonBtn.addEventListener('click', async () => {
  const dur = parseSeasonDuration()
  if (!dur) { toast('Selecciona inicio y fin.', 'error'); return }
  try {
    const r = await api('/gacha/admin/seasonal-characters-config/duration', { method: 'PUT', body: JSON.stringify({ season_duration: dur }) })
    toast(r.message, 'success')
  } catch (err) { toast(err.message, 'error') }
})

addSeasonalBtn.addEventListener('click', async () => {
  const name = availSelect.value
  const stock = parseInt(seasonalStockInput.value)
  if (!name) { toast('Selecciona un personaje.', 'error'); return }
  if (isNaN(stock) || stock < 0) { toast('Stock inválido.', 'error'); return }
  try {
    const r = await api('/gacha/admin/seasonal-characters-config/add-character', { method: 'POST', body: JSON.stringify({ name, stock }) })
    toast(r.message, 'success')
    loadSeasonalConfig()
    loadCharacters()
  } catch (err) { toast(err.message, 'error') }
})

async function removeSeasonalCharacter(name) {
  if (!await confirmDialog(`¿Quitar a "${name}" de temporada?`)) return
  try {
    const res = await fetch(`/gacha/admin/seasonal-characters-config/remove-character/${encodeURIComponent(name)}`, { method: 'DELETE' })
    const r = await res.json()
    if (!res.ok) throw new Error(r.error)
    toast(r.message, 'success')
    loadSeasonalConfig()
    loadCharacters()
  } catch (err) { toast(err.message, 'error') }
}

function renderSeasonalCharacters(chars) {
  seasonalList.innerHTML = ''
  if (!chars || chars.length === 0) {
    seasonalList.innerHTML = '<p style="padding:16px 24px;color:var(--text-dim)">No hay personajes de temporada.</p>'
    return
  }
  chars.forEach(c => {
    const card = document.createElement('div')
    card.className = 'card'
    card.innerHTML = `
      ${c.image_url ? `<img src="${c.image_url}" alt="">` : ''}
      <div class="card-body"><h4>${c.name}</h4><p>Stock: ${c.stock}</p></div>
      <button class="btn btn-sm btn-danger btn-remove-seasonal" data-name="${c.name}">✕</button>
    `
    seasonalList.appendChild(card)
  })
  seasonalList.querySelectorAll('.btn-remove-seasonal').forEach(b => b.addEventListener('click', () => removeSeasonalCharacter(b.dataset.name)))
}

/* ─── Keys ─── */
const userSearch = document.getElementById('user-search-input')
const keysTbody = document.getElementById('keys-tbody')

async function loadUserKeys() {
  keysTbody.innerHTML = '<tr><td colspan="3" class="loading-cell">Cargando...</td></tr>'
  try {
    const keys = await api('/gacha/admin/user-keys')
    renderUserKeys(keys)
  } catch (err) { toast('Error al cargar keys.', 'error'); keysTbody.innerHTML = '<tr><td colspan="3" class="loading-cell">Error</td></tr>' }
}

function renderUserKeys(keys) {
  const entries = Object.entries(keys)
  if (entries.length === 0) { keysTbody.innerHTML = '<tr><td colspan="3" class="loading-cell">No hay usuarios con keys.</td></tr>'; return }
  const searchTerm = userSearch.value.toLowerCase()
  const filtered = searchTerm ? entries.filter(([id, u]) => (u.userName || id).toLowerCase().includes(searchTerm)) : entries
  if (filtered.length === 0) { keysTbody.innerHTML = '<tr><td colspan="3" class="loading-cell">Sin resultados.</td></tr>'; return }

  keysTbody.innerHTML = filtered.map(([id, u]) => {
    const name = u.userName || id
    return `<tr data-username="${name}">
      <td><strong>${name}</strong></td>
      <td><span class="keys-count">${u.keys}</span></td>
      <td class="actions-cell">
        <input type="number" class="key-input" value="1" min="1" style="margin-right:4px">
        <button class="btn btn-sm btn-primary btn-send-keys" data-username="${name}">Enviar</button>
      </td>
    </tr>`
  }).join('')

  keysTbody.querySelectorAll('.btn-send-keys').forEach(b => b.addEventListener('click', () => sendKeys(b.dataset.username)))
}

async function sendKeys(username) {
  const tr = keysTbody.querySelector(`tr[data-username="${username}"]`)
  const input = tr.querySelector('.key-input')
  const count = parseInt(input.value)
  if (isNaN(count) || count <= 0) { toast('Cantidad inválida.', 'error'); return }
  if (!await confirmDialog(`Enviar ${count} keys a ${username}?`)) return
  try {
    const r = await api('/gacha/admin/user-keys/add', { method: 'POST', body: JSON.stringify({ username, keys: count }) })
    toast(r.message, 'success')
    const span = tr.querySelector('.keys-count')
    span.textContent = parseInt(span.textContent) + count
    input.value = 1
  } catch (err) { toast(err.message, 'error') }
}

userSearch.addEventListener('input', () => {
  loadUserKeys()
})

/* ─── Trades ─── */
const tradeFilter = document.getElementById('trade-status-filter')
const tradesTbody = document.getElementById('trades-tbody')

tradeFilter.addEventListener('change', loadTrades)

async function loadTrades() {
  tradesTbody.innerHTML = '<tr><td colspan="7" class="loading-cell">Cargando...</td></tr>'
  try {
    const trades = await api('/gacha/admin/trades')
    renderTrades(trades)
  } catch (err) { toast('Error al cargar trades.', 'error'); tradesTbody.innerHTML = '<tr><td colspan="7" class="loading-cell">Error</td></tr>' }
}

function renderTrades(trades) {
  if (!trades || trades.length === 0) { tradesTbody.innerHTML = '<tr><td colspan="7" class="loading-cell">No hay trades.</td></tr>'; return }
  const filter = tradeFilter.value
  const filtered = filter === 'all' ? trades : trades.filter(t => t.status === filter)
  if (filtered.length === 0) { tradesTbody.innerHTML = `<tr><td colspan="7" class="loading-cell">Sin trades ${filter}.</td></tr>`; return }

  tradesTbody.innerHTML = filtered.map(t => {
    const id = t.id.slice(0, 8)
    const createdAt = new Date(t.createdAt).toLocaleString()
    return `<tr>
      <td><code>${id}</code></td>
      <td>${t.offeringName}</td>
      <td>${t.characterName}</td>
      <td>${t.receivingName}</td>
      <td><span class="status-badge status-${t.status}">${t.status}</span></td>
      <td>${createdAt}</td>
      <td class="actions-cell">
        ${t.status === 'pending' ? `<button class="btn btn-sm btn-danger btn-cancel-trade" data-id="${t.id}">Cancelar</button>` : ''}
      </td>
    </tr>`
  }).join('')

  tradesTbody.querySelectorAll('.btn-cancel-trade').forEach(b => b.addEventListener('click', () => cancelTrade(b.dataset.id)))
}

async function cancelTrade(tradeId) {
  if (!await confirmDialog(`Cancelar trade ${tradeId.slice(0, 8)}?`)) return
  try {
    const res = await fetch(`/gacha/admin/trades/${tradeId}`, { method: 'DELETE' })
    const r = await res.json()
    if (!res.ok) throw new Error(r.error)
    toast(r.message, 'success')
    loadTrades()
  } catch (err) { toast(err.message, 'error') }
}

/* ─── Initialize ─── */
document.addEventListener('DOMContentLoaded', () => {
  loadCharacters()
  loadGachaConfig()
  loadSeasonalConfig()
  loadUserKeys()
  loadTrades()
})
