{{/*
Platform chart helper templates.
*/}}

{{- define "platform.labels" -}}
app.kubernetes.io/name: store-platform
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}

{{- define "platform.api.selectorLabels" -}}
app.kubernetes.io/name: store-platform
app.kubernetes.io/component: api
{{- end }}

{{- define "platform.dashboard.selectorLabels" -}}
app.kubernetes.io/name: store-platform
app.kubernetes.io/component: dashboard
{{- end }}
