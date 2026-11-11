<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

defineProps<{ title: string; text: string }>()
</script>

<template>
  <Card class="mx-auto mt-16 max-w-md text-center">
    <CardHeader>
      <CardTitle>{{ title }}</CardTitle>
      <CardDescription>{{ text }}</CardDescription>
    </CardHeader>
    <CardContent>
      <Button variant="outline" size="sm" as-child><RouterLink to="/">Back to overview</RouterLink></Button>
    </CardContent>
  </Card>
</template>
