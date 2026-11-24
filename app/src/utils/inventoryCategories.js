// 库存物品分类目录：大类 → 明细，明细名称即入库时保存的 category 值。
export const INVENTORY_CATEGORY_TREE = [
  {
    name: '食品饮料',
    icon: 'local_grocery_store',
    children: ['蔬菜', '水果', '肉禽蛋', '水产', '乳品', '主食粮油', '零食', '饮料', '酒水', '调味品', '冷冻食品', '熟食'],
  },
  {
    name: '药品保健',
    icon: 'medical_services',
    children: ['药品', '保健品', '医疗器械'],
  },
  {
    name: '日化清洁',
    icon: 'cleaning_services',
    children: ['日用品', '清洁用品', '纸品', '个护美妆'],
  },
  {
    name: '家居厨房',
    icon: 'kitchen',
    children: ['厨房用品', '家居用品', '收纳整理'],
  },
  {
    name: '其他用品',
    icon: 'category',
    children: ['宠物用品', '母婴用品', '文具', '电子配件', '其他'],
  },
]

export const INVENTORY_CATEGORY_LEAVES = INVENTORY_CATEGORY_TREE.flatMap((g) => g.children)

export function isPresetInventoryCategory(name) {
  return INVENTORY_CATEGORY_LEAVES.includes(String(name || '').trim())
}
