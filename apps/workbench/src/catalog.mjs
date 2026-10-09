import { resolve } from 'node:path';
import { resolveSkillRoot } from './skill-paths.mjs';

const skillRoot = resolveSkillRoot();
export const skills = {
  research: resolve(skillRoot, 'AI产品经理Skill/ai-product-manager-research'),
  initiation: resolve(skillRoot, 'pm-initiation-report'),
  workflow: resolve(skillRoot, 'edu-pm-workflow'),
};
export const stages = [
  { id: 'research', name: '市场 / 用户 / 机会', skill: 'research', modules: [
    { id: 'idea', name: '市场、用户与机会研究', deliverables: '在用户确认调研计划后，连续生成市场调研、用户画像、产品机会点与风险三个完整研究文档；含竞品事实、来源、研究范围、关键假设和证据缺口。不生成立项报告、PRD 或 MVP 方案。' },
  ] },
  { id: 'initiation', name: '立项报告', skill: 'initiation', modules: [
    { id: 'initiation', name: '产品立项报告', deliverables: '完整立项报告、可行性、优先级、风险与 MVP 简介。MVP 仅简介，详细方案交给设计阶段。' },
  ] },
  { id: 'design', name: 'MVP / PRD / 原型 / 流程', skill: 'workflow', modules: [
    { id: 'mvp', name: '完整 MVP 方案', deliverables: '完整 MVP 范围、核心闭环、优先级、验证指标与实验计划。' },
    { id: 'prd', name: '产品需求文档', deliverables: '完整 PRD：背景、目标、范围、业务规则、详细页面与交互、边界、数据口径。' },
    { id: 'prototype', name: '产品交互原型', deliverables: '生成完整界面与交互原型方案文档：页面、组件、状态与操作链路。用户按需点击生成 HTML 时再制作离线可交互原型。' },
    { id: 'flow', name: '业务与交互流程', deliverables: '业务流程与交互状态，文档包含可复制 Mermaid 源码、分支与异常处理。' },
  ] },
  { id: 'acceptance', name: '埋点与验收', skill: 'workflow', modules: [
    { id: 'tracking', name: '数据埋点方案', deliverables: '事件字典、触发规则、参数、统计口径与数据质量验证；缺既有字典明确标待确认。' },
    { id: 'acceptance', name: '产品验收清单', deliverables: '验收用例、前提、操作、预期结果、边界与可追踪需求。' },
  ] },
  { id: 'analysis', name: '数据分析', skill: 'workflow', modules: [
    { id: 'funnel', name: '转化漏斗分析', deliverables: '漏斗图、人数、步骤和累计转化率、流失与证据缺口。只能使用提供的数值，不自行生成数字。' },
    { id: 'retention', name: '使用与留存分析', deliverables: '留存/使用分析、分群、时间窗、口径与数据质量，缺用户级数据不能编造留存率。' },
    { id: 'ab', name: 'A/B 结果分析', deliverables: '实验组、对照组、指标口径、样本量、效果、统计假设与决策限制。' },
  ] },
  { id: 'review', name: '迭代复盘', skill: 'workflow', modules: [
    { id: 'review', name: '迭代复盘与计划', deliverables: '复盘、证据、优先级、迭代计划、责任与下一轮验证。' },
  ] },
];
export const modules = stages.flatMap(stage => stage.modules.map(module => ({ ...module, stageId: stage.id, skill: stage.skill })));
export function getModule(id) {
  const module = modules.find(item => item.id === id);
  if (!module && ['competitor','user'].includes(id)) return modules.find(item=>item.id==='idea');
  if (!module) throw new Error('模块不存在');
  return module;
}
