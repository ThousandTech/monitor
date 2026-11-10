from django.shortcuts import render
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from .service import collect_system_stats

# Create your views here.

@require_GET
def index(request):
    return render(request,"monitor/index.html")

@never_cache
@require_GET
def stats(request):
    return JsonResponse(collect_system_stats())