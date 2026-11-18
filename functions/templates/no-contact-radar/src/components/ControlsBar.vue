<script setup>
import { Search } from "@element-plus/icons-vue";

defineProps({
  days: { type: Number, required: true },
  includeNever: { type: Boolean, required: true },
  query: { type: String, required: true },
  options: { type: Array, required: true },
});
defineEmits(["update:days", "update:includeNever", "update:query"]);
</script>

<template>
  <el-card shadow="never">
    <el-form label-position="top" @submit.prevent>
      <el-row :gutter="16">
        <el-col :xs="24" :sm="8">
          <el-form-item label="No conversation in the last">
            <el-select :model-value="days" @update:model-value="$emit('update:days', $event)">
              <el-option v-for="o in options" :key="o" :label="`${o} days`" :value="o" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :xs="24" :sm="16">
          <el-form-item label="Filter">
            <el-input
              :model-value="query"
              clearable
              :prefix-icon="Search"
              placeholder="Name, email, phone or tag"
              @update:model-value="$emit('update:query', $event ?? '')"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-checkbox
        :model-value="includeNever"
        label="Include never contacted"
        @update:model-value="$emit('update:includeNever', $event)"
      />
    </el-form>
  </el-card>
</template>
