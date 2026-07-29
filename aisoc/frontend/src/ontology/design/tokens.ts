// Shared design tokens for the AISOC Ontology onboarding UI.

// Layer-1 domain palette — refined, cohesive "deep-tech" spectrum (cool→warm arc).
export const DOMAIN_META: Record<string, { color: string; label_en: string; label_zh: string }> = {
  D0: { color: '#8B7CF6', label_en: 'AI Orchestration & Knowledge', label_zh: 'AI 编排与知识底座' },
  D1: { color: '#4C9BFF', label_en: 'Data Ingestion & Asset Mapping', label_zh: '数据接入与资产测绘' },
  D2: { color: '#31C8E0', label_en: 'Detection Engineering', label_zh: '检测工程与告警运营' },
  D3: { color: '#2FD6A6', label_en: 'Investigation & Triage', label_zh: '安全调查与研判' },
  D4: { color: '#7BE0A0', label_en: 'Threat Hunting', label_zh: '主动威胁狩猎' },
  D5: { color: '#C08CF7', label_en: 'Threat Intelligence', label_zh: '威胁情报管理' },
  D6: { color: '#F4B740', label_en: 'Vulnerability & Exposure', label_zh: '漏洞与暴露面管理' },
  D7: { color: '#FF8A5B', label_en: 'Incident Response', label_zh: '事件响应与自动化处置' },
  D8: { color: '#FF6F91', label_en: 'Adversary Emulation', label_zh: '攻击模拟与检测验证' },
  D9: { color: '#9FB2CC', label_en: 'SecOps Metrics & Reporting', label_zh: '安全运营度量与报告' },
  // legacy v1 domain ids (kept for backward-compat with old snapshots)
  ORG: { color: '#4C9BFF', label_en: 'Organization', label_zh: '组织与业务' },
  AST: { color: '#2FD6A6', label_en: 'Asset & Identity', label_zh: '资产与身份' },
  NET: { color: '#31C8E0', label_en: 'Network & Exposure', label_zh: '网络与暴露面' },
  ING: { color: '#4C9BFF', label_en: 'Data Ingestion', label_zh: '数据接入' },
  DET: { color: '#F4B740', label_en: 'Detection & Analytics', label_zh: '检测分析' },
  IR: { color: '#FF8A5B', label_en: 'Incident Response', label_zh: '事件响应' },
  TI: { color: '#C08CF7', label_en: 'Threat Intelligence', label_zh: '威胁情报' },
  AI: { color: '#8B7CF6', label_en: 'AI Capability', label_zh: 'AI 能力层' },
  GOV: { color: '#9FB2CC', label_en: 'Data & Governance', label_zh: '数据底座与治理' },
};

export const domainColor = (d?: string) => DOMAIN_META[d || '']?.color || '#7C8DA6';

// Layer-3 object-type palette — muted jewel tones, distinct from domain arc so
// the three layers read as three visual "registers" (域=饱和, 对象=低饱和金属色).
export const OBJECT_TYPE_META: Record<string, { color: string; label: string }> = {
  system: { color: '#5B8DEF', label: '对接系统' },
  data_source: { color: '#3FB9A0', label: '数据源' },
  tool: { color: '#D4A64A', label: '工具' },
  action: { color: '#A98BE0', label: '动作' },
};

export const objectTypeColor = (t?: string) => OBJECT_TYPE_META[t || '']?.color || '#7C8DA6';

export const STATUS_META: Record<string, { color: string; label: string; chip: string }> = {
  satisfied: { color: '#2FD6A6', label: 'Satisfied', chip: 'chip-satisfied' },
  partial: { color: '#F4B740', label: 'Partial', chip: 'chip-partial' },
  missing: { color: '#FF6B8A', label: 'Missing', chip: 'chip-missing' },
  extra: { color: '#B69CF7', label: 'Extra', chip: 'chip-extra' },
};

export const statusColor = (s?: string) => STATUS_META[s || '']?.color || '#5D7292';
