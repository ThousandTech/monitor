from django.shortcuts import render
from django.core.cache import caches
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

# Create your views here.

@require_GET
def index(request):
    return render(request,"monitor/index.html")

@never_cache
@require_GET
def stats(request):
    snapshot = caches["monitor"].get("system_stats")

    if snapshot is None:
        return JsonResponse(
            {"error":"system stats not available"},
            status=503,
        )

    return JsonResponse(snapshot)