// 实体展示映射：把后端 DisplayEntity 转为各视图卡片所需的结构。
// 后端字段：{ entity_id, domain, state, friendly_name, icon, device_class, unit, area, floor, attributes }

// 判断实体是否"开启"（按 domain 语义 + state 文本）。
export function isOn(entity) {
  if (!entity) return false
  const s = String(entity.state || '').toLowerCase()
  if (s === 'on' || s === 'open' || s === 'opening' || s === 'playing') return true
  if (s === 'unlocked' || s === 'disarmed') return true
  return false
}

// 判断实体是否可用（在线）。HA 用 unavailable 表示设备失联、unknown 表示状态未就绪，
// 二者都算不在线；disabled 的实体不参与判断。
export function isAvailable(entity) {
  if (!entity || entity.disabled) return false
  const s = String(entity.state || '').toLowerCase()
  return s !== '' && s !== 'unavailable' && s !== 'unknown'
}

// 前端 tabs 的 type 归类（与后端 matchesType 对齐）。
export function classifyType(entity) {
  const d = entity.domain
  const name = (entity.friendly_name || '')
  if (d === 'light') return 'lighting'
  if (d === 'climate' || d === 'fan' || d === 'humidifier' || d === 'air_quality' || name.includes('空调') || name.includes('空气净化')) return 'climate'
  if (d === 'lock' || d === 'alarm_control_panel' || d === 'camera' || name.includes('摄像头') || name.includes('门锁')) return 'security'
  if (d === 'cover') return 'curtain'
  if (d === 'switch' || d === 'plug' || d === 'binary_sensor') return 'other'
  return 'other'
}

// tabKey → 展示名（DevicesView tabs 复用）。
export const typeTabs = [
  { key: 'all', label: '全部' },
  { key: 'lighting', label: '💡 灯光' },
  { key: 'climate', label: '🌡 环境' },
  { key: 'security', label: '🔒 安防' },
  { key: 'curtain', label: '🪟 窗帘' },
  { key: 'other', label: '⚙ 其他' },
]

// 按 entity_id 分组到房间（取 area 字段，缺省"未分组"；没有 area 信息时按 domain 归入提示）。
export function groupByRoom(entities) {
  const map = new Map()
  for (const e of entities || []) {
    const room = (e.area && e.area.trim()) || '其他设备'
    if (!map.has(room)) map.set(room, [])
    map.get(room).push(e)
  }
  return [...map.entries()].map(([name, list]) => ({ name, devices: list }))
}

// HA 图标是 mdi:xxx（Material Design Icons）命名，与前端渲染用的 Material Symbols 字体
// 是两套图标集：直接去前缀当连字用，绝大多数 mdi 名匹配不到，会渲染成空白或字面文字。
// 此表把常见 mdi 名映射到 Material Symbols 连字；未收录的回退领域默认图标。
const mdiMap = {
  // 灯光
  lightbulb: 'lightbulb', lightbulb_on: 'lightbulb', lightbulb_variant: 'lightbulb', lightbulb_fluorescent_tube: 'lightbulb',
  desk_lamp: 'lightbulb', desk_lamp_on: 'lightbulb', floor_lamp: 'lightbulb', floor_lamp_dual: 'lightbulb', floor_lamp_torchiere: 'lightbulb',
  pendant_lamp: 'lightbulb', ceiling_light: 'lightbulb', ceiling_light_round: 'lightbulb', ceiling_light_double: 'lightbulb',
  lamp: 'light', string_lights: 'lightbulb', holiday_light: 'lightbulb', led_strip: 'lightbulb', led_on: 'lightbulb',
  led_off: 'lightbulb', led_variant: 'lightbulb', outdoor_lamp: 'lightbulb', wall_sconce: 'lightbulb', wall_sconce_round: 'lightbulb',
  track_light: 'lightbulb', spotlight: 'lightbulb', light_flood: 'light', light_recessed: 'light',
  light_switch: 'toggle_on', ceiling_fan: 'ceiling_fan', ceiling_fan_off: 'ceiling_fan',
  // 开关 / 电源
  toggle_switch: 'toggle_on', toggle_switch_off: 'toggle_off', toggle_switch_variant: 'toggle_on',
  power: 'power', power_off: 'power_off', power_on: 'power', power_socket: 'power', power_socket_au: 'power',
  power_socket_eu: 'power', power_socket_uk: 'power', power_plug: 'power', power_plug_off: 'power_off',
  power_cycle: 'restart_alt', power_settings: 'power_settings_new',
  // 影音
  speaker: 'speaker', speaker_wireless: 'speaker', speaker_off: 'speaker', sonos: 'speaker',
  theater: 'theaters', movie: 'movie', movie_open: 'smart_display', album: 'album', music: 'music_note',
  music_circle: 'music_note', music_note: 'music_note', radio: 'radio', radio_tower: 'podcasts', podcast: 'podcasts',
  play: 'play_arrow', play_circle: 'play_circle', pause: 'pause', pause_circle: 'pause_circle',
  stop: 'stop', stop_circle: 'stop_circle', skip_next: 'skip_next', skip_previous: 'skip_previous',
  fast_forward: 'fast_forward', rewind: 'fast_rewind', record: 'fiber_manual_record',
  volume_high: 'volume_up', volume_medium: 'volume_up', volume_low: 'volume_down', volume_off: 'volume_off',
  volume_mute: 'volume_off', equalizer: 'equalizer', graphic_eq: 'graphic_eq',
  cast: 'cast', cast_connected: 'cast_connected', chromecast: 'cast', airplay: 'settings_input_antenna',
  youtube: 'smart_display', netflix: 'smart_display', hulu: 'smart_display', prime: 'smart_display',
  spotify: 'graphic_eq', apple: 'apple', android: 'android', windows: 'windows', linux: 'linux',
  google_home: 'speaker', google_assistant: 'smart_toy', alexa: 'settings_voice', siri: 'mic',
  // 屏幕 / 计算
  monitor: 'desktop_windows', monitor_off: 'desktop_windows', laptop: 'laptop', tablet: 'tablet',
  cellphone: 'smartphone', cellphone_link: 'phonelink', cellphone_wireless: 'smartphone',
  television: 'tv', television_classic: 'tv', television_guide: 'tv', television_box: 'tv',
  keyboard: 'keyboard', mouse: 'mouse', printer: 'print', scanner: 'scanner',
  server: 'dns', database: 'database', nas: 'dns',
  // 环境 / 温控
  air_conditioner: 'ac_unit', air_conditioner_unit: 'ac_unit', heat_pump: 'heat_pump', heat_pump_variant: 'heat_pump',
  radiator: 'heat_pump', thermostat: 'thermostat', thermostat_box: 'device_thermostat',
  thermometer: 'device_thermostat', thermometer_low: 'device_thermostat', thermometer_high: 'device_thermostat',
  thermometer_lines: 'device_thermostat', temperature_celsius: 'device_thermostat', temperature_fahrenheit: 'device_thermostat',
  water_boiler: 'water_heater', boiler: 'water_heater', water_heater: 'water_heater',
  air_freshener: 'air', air_purifier: 'air', air_humidifier: 'water_drop', humidifier: 'water_drop',
  humidifier_off: 'water_drop', dehumidifier: 'water_drop', wind_power: 'wind_power', wind_turbine: 'wind_power',
  // 水 / 卫浴 / 清洁
  water: 'water', water_off: 'water', water_percent: 'water_drop', water_pump: 'water_drop',
  water_sync: 'water', water_check: 'water', waves: 'water', wave: 'water',
  shower: 'shower', shower_head: 'shower', bathtub: 'bathtub', toilet: 'toilet', sink: 'water_drop',
  faucet: 'water_drop', faucet_variant: 'water_drop', dishwasher: 'dishwasher', dishwasher_alert: 'dishwasher',
  washing_machine: 'local_laundry_service', tumble_dryer: 'local_laundry_service', dryer: 'local_laundry_service',
  iron: 'local_laundry_service', vacuum: 'smart_toy', robot_vacuum: 'smart_toy', robot_vacuum_variant: 'smart_toy',
  broom: 'cleaning_services', mop: 'cleaning_services', brush: 'brush',
  // 安防 / 门窗
  lock: 'lock', lock_open: 'lock_open', lock_alert: 'lock', lock_check: 'lock', lock_clock: 'lock',
  shield: 'shield', shield_home: 'security', shield_lock: 'lock', shield_off: 'shield', shield_alert: 'shield',
  shield_check: 'shield', shield_star: 'shield', shield_lock_open: 'lock_open', security: 'security',
  alarm_light: 'warning', alarm_panel: 'security',
  door: 'door_front', door_closed: 'door_front', door_open: 'door_open', door_sliding: 'door_sliding',
  gate: 'gate', garage: 'garage', garage_alert: 'garage', fence: 'fence',
  window: 'window', window_closed: 'window', window_open: 'window', window_shutter: 'roller_shades',
  window_shutter_alert: 'roller_shades', window_shutter_open: 'roller_shades',
  motion_sensor: 'sensor_occupied', motion_sensor_off: 'sensor_occupied', motion: 'directions_run',
  doorbell: 'doorbell', doorbell_video: 'videocam',
  camera: 'photo_camera', camera_off: 'photo_camera', cctv: 'videocam', cctv_off: 'videocam_off',
  video: 'videocam', video_off: 'videocam_off', video_switch: 'switch_video', webcam: 'videocam',
  eye: 'visibility', eye_off: 'visibility_off', fingerprint: 'fingerprint',
  key: 'key', key_variant: 'key', key_wireless: 'key',
  // 传感器 / 仪表
  sensors: 'sensors', gauge: 'speed', speedometer: 'speed', speedometer_medium: 'speed', speedometer_slow: 'speed',
  counter: 'counter', scale: 'scale', scale_balance: 'balance', ruler: 'straighten', tape_measure: 'straighten',
  battery: 'battery_std', battery_low: 'battery_alert', battery_medium: 'battery_std', battery_high: 'battery_full',
  battery_charging: 'battery_charging_full', battery_unknown: 'battery_unknown', battery_alert: 'battery_alert',
  flash: 'bolt', lightning_bolt: 'bolt', flash_off: 'bolt', flash_outline: 'bolt',
  solar_power: 'solar_power', fuel: 'local_gas_station', gas_cylinder: 'gas_meter', oil: 'oil',
  leaf: 'forest', sprout: 'spa', flower: 'local_florist', flower_tulip: 'local_florist', tree: 'forest',
  grass: 'yard', potted_plant: 'potted_plant', potted_plant_outline: 'potted_plant',
  dog: 'pets', cat: 'pets', paw: 'pets', fish: 'fish', bird: 'bird', rabbit: 'rabbit', turtle: 'turtle',
  human: 'person', walk: 'directions_walk', run: 'directions_run', bike: 'directions_bike',
  motorcycle: 'two_wheeler', car: 'directions_car', car_electric: 'electric_car', bus: 'directions_bus',
  train: 'train', tram: 'tram', subway: 'subway', airplane: 'flight', boat: 'directions_boat',
  ship: 'directions_boat', truck: 'local_shipping', skateboard: 'skateboarding',
  // 网络
  wifi: 'wifi', wifi_off: 'wifi_off', wifi_strength: 'network_wifi', ethernet: 'settings_ethernet',
  lan: 'lan', lan_connect: 'lan', lan_disconnect: 'lan', network: 'hub', ip_network: 'dns',
  router: 'router', router_wireless: 'router', access_point: 'access_point', switch_off: 'toggle_off',
  bluetooth: 'bluetooth', bluetooth_audio: 'bluetooth', bluetooth_connect: 'bluetooth',
  cloud: 'cloud', cloud_off: 'cloud_off', cloud_download: 'cloud_download', cloud_upload: 'cloud_upload',
  cloud_check: 'cloud_done', cloud_question: 'cloud', cloud_alert: 'cloud', cloud_sync: 'sync',
  signal: 'network_cell', signal_cellular: 'network_cell',
  // 天气
  sun: 'wb_sunny', white_balance_sunny: 'wb_sunny', weather_sunny: 'wb_sunny',
  weather_night: 'bedtime', weather_partly_cloudy: 'partly_cloudy_day', weather_partly_cloudy_night: 'partly_cloudy_night',
  weather_cloudy: 'cloudy', weather_overcast: 'cloud', weather_rainy: 'cloud', weather_pouring: 'cloud',
  weather_lightning: 'thunderstorm', weather_lightning_rainy: 'thunderstorm', weather_snowy: 'snowing',
  weather_snowy_rainy: 'sleet', weather_hail: 'cloudy_snowing', weather_fog: 'foggy', weather_hazy: 'hazy',
  weather_dust: 'dusty', weather_smog: 'smog', weather_windy: 'breeze', weather_wind: 'breeze',
  weather_sunset: 'wb_twilight', weather_sunrise: 'wb_twilight', weather_eclipse: 'eclipse',
  weather_snowflake: 'ac_unit', snowflake: 'ac_unit', star: 'star', moon: 'bedtime',
  moon_waning_crescent: 'bedtime', star_crescent: 'star',
  // 家居 / 场所
  home: 'home', home_variant: 'home', home_assistant: 'home', home_circle: 'home', home_automation: 'home',
  home_lightbulb: 'light_home', house: 'home', building: 'business', office_building: 'business',
  store: 'store', school: 'school', hospital: 'local_hospital', church: 'church',
  mosque: 'mosque', synagogue: 'synagogue', temple: 'temple_hindu', castle: 'castle', village: 'village', city: 'city',
  sofa: 'chair', chair: 'chair', table_furniture: 'table_restaurant', bed: 'hotel',
  fridge: 'refrigerator', kitchen: 'kitchen', oven: 'oven', microwave: 'microwave', kettle: 'kettle',
  coffee: 'coffee', coffee_maker: 'coffee_maker', wine: 'local_bar', beer: 'local_drink', liquor: 'liquor',
  cake: 'cake', food: 'restaurant', food_apple: 'nutrition', pantry: 'shelves',
  // 工具 / 杂项
  cog: 'settings', cog_outline: 'settings', cog_box: 'settings', settings: 'settings', tune: 'tune',
  sliders: 'tune', sliders_horizontal: 'tune', wrench: 'build', hammer: 'hardware',
  pencil: 'edit', pen: 'draw', marker: 'draw', highlighter: 'style', eraser: 'ink_eraser',
  palette: 'palette', paint_roller: 'paint_roller', brush: 'brush',
  chart_line: 'show_chart', chart_bar: 'bar_chart', chart_areaspline: 'area_chart', chart_pie: 'pie_chart',
  chart_donut: 'donut_large', chart_bubble: 'bubble_chart', chart_timeline: 'timeline', chart_box: 'candlestick_chart',
  table: 'table', table_large: 'table', view_grid: 'grid_view', view_list: 'list', apps: 'apps',
  shape: 'category', shape_circle: 'circle', shape_square: 'square', shape_rectangle: 'rectangle',
  shape_oval: 'ellipse', shape_triangle: 'change_history', shape_diamond: 'diamond', shape_hexagon: 'hexagon',
  shape_star: 'star', shape_heart: 'favorite', shape_cloud: 'cloud', shape_sparkle: 'auto_awesome',
  shape_shield: 'shield', shape_plus: 'add', shape_minus: 'remove',
  clock: 'schedule', clock_outline: 'schedule', clock_fast: 'update', timer: 'timer', timer_outline: 'timer',
  hourglass: 'hourglass_top', stopwatch: 'timer', alarm: 'alarm', calendar: 'calendar_month',
  calendar_today: 'today', calendar_blank: 'calendar_month', date_range: 'date_range',
  bell: 'notifications', bell_off: 'notifications_off', bell_ring: 'notifications_active', bell_outline: 'notifications',
  email: 'mail', email_outline: 'mail', message: 'chat', message_text: 'chat', phone: 'call', phone_in_talk: 'call',
  map: 'map', map_marker: 'location_on', map_marker_outline: 'location_on', map_search: 'map',
  compass: 'explore', crosshairs: 'my_location', target: 'center_focus_strong',
  globe_earth: 'public', earth: 'public', earth_box: 'public', rocket: 'rocket',
  satellite: 'satellite_alt', satellite_uplink: 'satellite_alt', microscope: 'biotech', telescope: 'search',
  binoculars: 'search', book: 'menu_book', book_open: 'auto_stories', library: 'library_books',
  newspaper: 'newspaper', rss: 'rss_feed', flag: 'flag', flag_checkered: 'flag', flag_variant: 'flag',
  weight_lifter: 'fitness_center', dumbbell: 'fitness_center', yoga: 'self_improvement', pool: 'pool',
  soccer: 'sports_soccer', basketball: 'sports_basketball', tennis: 'sports_tennis', golf: 'sports_golf',
  football: 'sports_football', baseball: 'sports_baseball', volleyball: 'sports_volleyball',
  medicine: 'medication', pill: 'medication', syringe: 'vaccination', test_tube: 'science', atom: 'science',
  dna: 'biotech', virus: 'coronavirus', smoke: 'smoking_rooms', smoke_detector: 'detector_smoke',
  co2: 'co2', carbon_monoxide: 'detector_co', oxygen: 'oxygen', nitrogen: 'science',
  account: 'person', account_circle: 'account_circle', account_group: 'groups', account_multiple: 'groups',
  account_supervisor: 'supervisor_account', face: 'face', face_man: 'face', face_woman: 'face',
  face_recognition: 'face', human_child: 'child_care',
  update: 'update', download: 'download', upload: 'upload', progress_download: 'download',
  delete: 'delete', delete_trash: 'delete', trash_can: 'delete', restore: 'restore',
  plus: 'add', plus_circle: 'add_circle', minus: 'remove', minus_circle: 'remove_circle',
  check: 'check', check_circle: 'check_circle', close: 'close', close_circle: 'cancel',
  alert: 'warning', alert_circle: 'error', information: 'info', information_outline: 'info',
  help: 'help', help_circle: 'help', star_outline: 'star', star_half: 'star_half',
  heart: 'favorite', heart_outline: 'favorite', bookmark: 'bookmark', tag: 'label',
  percent: 'percent', cash: 'payments', cash_multiple: 'payments', cash_register: 'point_of_sale',
  credit_card: 'credit_card', bank: 'account_balance', finance: 'finance',
  timer_sand: 'hourglass_top', vacuum_outlet: 'cleaning_services',
}

// 把 HA 的 mdi:xxx 图标转换为 Material Symbols 连字名；未收录的回退领域默认图标，
// 避免不存在的连字渲染成空白或字面文字。
export function iconFor(entity, fallback = 'widgets') {
  const raw = entity?.icon || ''
  if (!raw) return fallback
  // HA 图标形如 mdi:lightbulb；去掉前缀并处理连字符→下划线。
  const base = raw.split(':').pop() || ''
  if (!base) return fallback
  const key = base.toLowerCase().replace(/-/g, '_')
  if (mdiMap[key]) return mdiMap[key]
  // 电量类图标带数字后缀（battery-90 等），统一归并
  if (key.startsWith('battery')) return key.includes('charging') ? 'battery_charging_full' : 'battery_std'
  // 去掉 _outline 后缀再试一次（mdi 大量 outline 变体）
  const stripped = key.replace(/_outline$/, '')
  if (mdiMap[stripped]) return mdiMap[stripped]
  return fallback
}

// 提取 attributes 中的字符串/数值字段。
export function attr(entity, key, fallback = '') {
  const a = entity?.attributes
  if (!a) return fallback
  const v = a[key]
  return v === undefined || v === null ? fallback : v
}

// 安全转数值；非有限数返回 null。
export function numVal(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

// 单个实体当前功耗(W)：优先 current_power_w，其次 power。
export function powerOf(e) {
  return numVal(attr(e, 'current_power_w')) ?? numVal(attr(e, 'power'))
}

// 一组实体总功耗(W)；kW = W/1000。
export function totalPower(entities) {
  return (entities || []).reduce((s, e) => s + (powerOf(e) || 0), 0)
}

// 生成设备卡片的动态 class 组（前端各卡片复用配色，简单启发式）。
export const palette = {
  light: { iconBox: 'bg-primary/15 border border-primary/30', iconColor: 'text-primary', toggleColor: 'bg-primary' },
  climate: { iconBox: 'bg-info/15 border border-info/30', iconColor: 'text-info', toggleColor: 'bg-info' },
  security: { iconBox: 'bg-success/15 border border-success/30', iconColor: 'text-success', toggleColor: 'bg-success' },
  curtain: { iconBox: 'bg-warning/15 border border-warning/30', iconColor: 'text-warning', toggleColor: 'bg-warning' },
  other: { iconBox: 'bg-accent/15 border border-accent/30', iconColor: 'text-accent', toggleColor: 'bg-accent' },
}

// ---- HA 领域卡片基础规范：domain → 图标/配色/默认字标（与 HA 原生对齐） ----
export const domainColorCls = {
  light: 'text-warning', switch: 'text-primary', plug: 'text-primary', valve: 'text-primary',
  fan: 'text-info', input_boolean: 'text-success', button: 'text-info', input_button: 'text-info',
  sensor: 'text-info', binary_sensor: 'text-success', number: 'text-info', input_number: 'text-info',
  climate: 'text-info', water_heater: 'text-warning', humidifier: 'text-info',
  cover: 'text-warning', media_player: 'text-accent', lock: 'text-success',
  alarm_control_panel: 'text-success', camera: 'text-accent', vacuum: 'text-info',
  scene: 'text-info', script: 'text-info', automation: 'text-info',
  person: 'text-success', device_tracker: 'text-success', zone: 'text-success', sun: 'text-warning',
  weather: 'text-info', update: 'text-warning', select: 'text-info', input_select: 'text-info',
  text: 'text-muted', input_text: 'text-muted', time: 'text-info', input_datetime: 'text-info',
  timer: 'text-warning', calendar: 'text-info', siren: 'text-warning', remote: 'text-primary',
  group: 'text-primary', plant: 'text-success', counter: 'text-info', fan: 'text-info',
  event: 'text-info', image: 'text-accent', lawn_mower: 'text-success', date: 'text-info', datetime: 'text-info',
}

export const domainGlyph = {
  light: 'lightbulb', switch: 'toggle_on', plug: 'power', valve: 'water',
  fan: 'mode_fan', input_boolean: 'check_circle', button: 'radio_button_checked', input_button: 'radio_button_checked',
  sensor: 'sensors', binary_sensor: 'sensors', number: 'pin', input_number: 'pin',
  climate: 'thermostat', water_heater: 'water_heater', humidifier: 'water_drop',
  cover: 'curtains', media_player: 'tv', lock: 'lock',
  alarm_control_panel: 'shield', camera: 'videocam', vacuum: 'smart_toy',
  scene: 'auto_awesome', script: 'terminal', automation: 'bolt',
  person: 'person', device_tracker: 'location_on', zone: 'location_on', sun: 'wb_sunny',
  weather: 'partly_cloudy_day', update: 'system_update', select: 'arrow_drop_down_circle', input_select: 'arrow_drop_down_circle',
  text: 'text_fields', input_text: 'text_fields', time: 'schedule', input_datetime: 'calendar_today',
  timer: 'timer', calendar: 'calendar_month', siren: 'notification_important', remote: 'settings_remote',
  group: 'group_work', plant: 'spa', counter: 'counter',
  event: 'event', image: 'image', lawn_mower: 'yard', date: 'calendar_today', datetime: 'calendar_today',
}

// 判断实体是否可一键开关（领域语义 + 当前状态），用于通用卡/开关类卡渲染控制。
export const toggleableDomains = new Set([
  'light', 'switch', 'plug', 'fan', 'valve', 'input_boolean', 'group', 'remote',
  'siren', 'cover', 'media_player', 'lock', 'vacuum', 'humidifier', 'automation',
])
export function canToggle(entity) {
  if (!entity) return false
  return toggleableDomains.has(entity.domain)
}

// 提取用于通用卡片展示的关键属性（优先显示核心数值）。
export function keyAttr(e) {
  if (!e) return []
  const a = e.attributes || {}
  const want = ['current_temperature', 'temperature', 'humidity', 'current_power_w', 'power', 'voltage',
    'battery_level', 'battery', 'brightness', 'illuminance', 'air_quality_index', 'pm2_5', 'pm10',
    'co2', 'pressure', 'wind_speed', 'current', 'energy', 'volume_level', 'media_title', 'device_class']
  const out = []
  for (const k of want) {
    if (a[k] !== undefined && a[k] !== null && a[k] !== '') {
      const u = (k === 'temperature' || k === 'current_temperature') ? (a.unit_of_measurement || '°C')
        : k === 'humidity' ? '%'
        : k === 'battery_level' || k === 'battery' ? '%'
        : k === 'volume_level' ? '%'
        : (a.unit_of_measurement || '')
      out.push({ key: k, label: k, value: a[k], unit: u })
    }
  }
  return out.slice(0, 3)
}