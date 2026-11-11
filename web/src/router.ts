import { createRouter, createWebHistory } from 'vue-router'
import ComingSoon from './views/ComingSoonView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: () => import('./views/DashboardView.vue') },
    { path: '/prs', name: 'prs', component: () => import('./views/PullRequestsView.vue') },
    { path: '/slack', name: 'slack', component: () => import('./views/SlackView.vue') },
    { path: '/graph', name: 'graph', component: () => import('./views/GraphView.vue') },
    {
      path: '/jira',
      name: 'jira',
      component: ComingSoon,
      props: { title: 'Jira board', text: 'Jira tasks with their linked PRs are next. Your tasks already show in the Overview panel.' },
    },
    { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
  ],
})
