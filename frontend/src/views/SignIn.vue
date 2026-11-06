<script setup lang="ts">
import { useAuth } from '@/composables/useAuth'
import AuthForm from './AuthForm.vue'

const { signIn } = useAuth()
</script>

<template>
  <AuthForm
    title="Welcome back"
    subtitle="Sign in to continue building with Genesis."
    submit-label="Sign in"
    alt-text="New to Genesis?"
    alt-link="/signup"
    alt-label="Create an account"
    :action="signIn"
  />
</template>
