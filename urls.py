from django.urls import path

from . import views

app_name = 'monitor'

urlpatterns = [
    path("",views.index,name='index'),
    path("api/stats/",views.stats,name='stats'),
]