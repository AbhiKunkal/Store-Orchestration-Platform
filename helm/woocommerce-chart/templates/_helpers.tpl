{{/*
Common helper templates for the WooCommerce store chart.

WHY _helpers.tpl?
Helm convention for reusable template snippets.
Keeps actual templates DRY (Don't Repeat Yourself).
*/}}

{{/*
Generate a full resource name: store-{id}-{component}
Example: store-abc-wordpress, store-abc-mysql
*/}}
{{- define "woocommerce.fullname" -}}
{{ .Values.store.id }}
{{- end }}

{{/*
Common labels applied to ALL resources in this chart.
These are critical for:
- Helm tracking (which resources belong to this release)
- kubectl filtering (kubectl get pods -l app.kubernetes.io/instance=store-abc)
- Service selectors (routing traffic to correct pods)
*/}}
{{- define "woocommerce.labels" -}}
app.kubernetes.io/name: woocommerce
app.kubernetes.io/instance: {{ .Values.store.id }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
store.platform/store-id: {{ .Values.store.id }}
{{- end }}

{{/*
Selector labels — subset of labels used for Service → Pod matching.
Must be immutable after creation (K8s requirement for selectors).
*/}}
{{- define "woocommerce.selectorLabels" -}}
app.kubernetes.io/name: woocommerce
app.kubernetes.io/instance: {{ .Values.store.id }}
{{- end }}

{{/*
MySQL specific selector
*/}}
{{- define "woocommerce.mysql.selectorLabels" -}}
app.kubernetes.io/name: mysql
app.kubernetes.io/instance: {{ .Values.store.id }}
app.kubernetes.io/component: database
{{- end }}

{{/*
WordPress specific selector
*/}}
{{- define "woocommerce.wordpress.selectorLabels" -}}
app.kubernetes.io/name: wordpress
app.kubernetes.io/instance: {{ .Values.store.id }}
app.kubernetes.io/component: storefront
{{- end }}
