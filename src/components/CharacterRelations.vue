<script setup lang="ts">
import type { DiscoveryStatus } from '../composables/useUnicodeDiscovery';
import type { CharacterRelationship, RelationshipGroup } from '../explorer/discoveryTypes';
import { errorStatusSuffix, useI18n } from '../i18n';
import { displaySequence, formatCodePoint } from '../unicode';

defineProps<{
  groups: RelationshipGroup[];
  status: DiscoveryStatus;
  error: string | null;
  unicodeVersion: string | null;
  uts39Version: string | null;
}>();

const emit = defineEmits<{
  explore: [relationship: CharacterRelationship];
  retry: [];
}>();
const { locale, t } = useI18n();

function formatScalars(target: Uint32Array): string {
  return Array.from(target, formatCodePoint).join(' + ');
}

const groupCopy: Record<string, { title: string; description: string }> = {
  canonical: {
    title: '规范相关字符',
    description: '通过规范分解关联的字符。这些属于规范化关系。',
  },
  compatibility: {
    title: '兼容相关字符',
    description: '兼容分解可到达当前序列的字符。',
  },
  case: {
    title: '大小写关系',
    description: '简单大小写映射与默认 Unicode 大小写折叠关系。',
  },
  confusable: {
    title: '视觉易混淆字符',
    description: 'UTS #39 骨架匹配是安全信号，并不表示规范化或语义等价。',
  },
};

function groupTitle(group: RelationshipGroup): string {
  return locale.value === 'zh-CN' ? (groupCopy[group.id]?.title ?? group.title) : group.title;
}

function groupDescription(group: RelationshipGroup): string {
  return locale.value === 'zh-CN'
    ? (groupCopy[group.id]?.description ?? group.description)
    : group.description;
}

function relationshipLabel(relationship: CharacterRelationship): string {
  if (locale.value !== 'zh-CN') return relationship.label;
  if (relationship.label === 'Shared canonical base') return '共享规范基本字符';
  const labels: Record<string, string> = {
    canonical: '规范等价',
    compatibility: '兼容相关',
    uppercase: '简单大写',
    lowercase: '简单小写',
    titlecase: '简单标题大小写',
    'case-fold': '相同大小写折叠结果',
    confusable: '相同 UTS #39 骨架',
  };
  return labels[relationship.kind] ?? relationship.label;
}

function relationshipDetail(relationship: CharacterRelationship): string {
  if (locale.value !== 'zh-CN') return relationship.detail;
  return relationship.detail
    .replace(/^NFD is /, 'NFD 为 ')
    .replace(/^NFKD is /, 'NFKD 为 ')
    .replace(/^Canonical decomposition begins with /, '规范分解以 ')
    .replace(/^Case-fold mapping is /, '大小写折叠映射为 ')
    .replace(/^Default case fold is /, '默认大小写折叠为 ')
    .replace(/^Confusable skeleton is /, '易混淆骨架为 ')
    .replace(/\. Appearance depends on the font\.$/, '。外观取决于字体。')
    .replace(/^Simple uppercase maps to /, '简单大写映射为 ')
    .replace(/^Simple lowercase maps to /, '简单小写映射为 ')
    .replace(/^Simple titlecase maps to /, '简单标题大小写映射为 ');
}
</script>

<template>
  <section class="explorer-section relations-section" aria-labelledby="relations-heading">
    <div class="section-heading">
      <h3 id="relations-heading">{{ t('relations.title') }}</h3>
      <span v-if="unicodeVersion">Unicode {{ unicodeVersion }}</span>
    </div>

    <p v-if="status === 'idle'" class="decomposition-empty">
      {{ t('relations.idle') }}
    </p>
    <p v-else-if="status === 'loading'" class="decomposition-empty" role="status">
      {{ t('relations.loading') }}
    </p>
    <div v-else-if="status === 'error'" class="relationship-load-error" role="alert">
      <p class="error-message">
        {{ t('relations.error', { status: errorStatusSuffix(error, locale) }) }}
      </p>
      <button type="button" @click="emit('retry')">{{ t('relations.retry') }}</button>
    </div>
    <div v-else class="relationship-groups">
      <article v-for="group in groups" :key="group.id" class="relationship-group">
        <div class="relationship-heading">
          <div>
            <h4>{{ groupTitle(group) }}</h4>
            <p>{{ groupDescription(group) }}</p>
          </div>
          <span v-if="group.id === 'confusable' && uts39Version">UTS #39 · {{ uts39Version }}</span>
          <span v-else>{{
            t('relations.results', { count: group.total, suffix: group.total === 1 ? '' : 's' })
          }}</span>
        </div>
        <div v-if="group.results.length" class="relationship-results">
          <button
            v-for="relationship in group.results"
            :key="`${group.id}-${Array.from(relationship.target).join('-')}`"
            type="button"
            class="relationship-card"
            @click="emit('explore', relationship)"
          >
            <span class="relationship-preview">{{ displaySequence(relationship.target) }}</span>
            <span class="relationship-copy">
              <strong>{{ relationshipLabel(relationship) }}</strong>
              <code>{{ formatScalars(relationship.target) }}</code>
              <small>{{ relationship.name ?? t('relations.sequence') }}</small>
              <small>{{ relationshipDetail(relationship) }}</small>
            </span>
          </button>
          <p v-if="group.total > group.results.length" class="result-limit-note">
            {{ t('relations.showing', { shown: group.results.length, total: group.total }) }}
          </p>
        </div>
        <p v-else class="decomposition-empty">
          {{ t('relations.none', { title: groupTitle(group).toLowerCase() }) }}
        </p>
      </article>
    </div>
  </section>
</template>
