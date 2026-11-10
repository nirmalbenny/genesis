<script setup lang="ts">
import { useAuth } from '@/composables/useAuth'
import AuthForm from './AuthForm.vue'

const { signUp } = useAuth()
</script>

<template>
  <AuthForm
    title="Create your Genesis account"
    subtitle="It takes a minute. You'll verify your email, then connect HighLevel."
    submit-label="Create account"
    alt-text="Already have an account?"
    alt-link="/signin"
    alt-label="Sign in"
    :action="signUp"
    confirm-password
  />
</template>
