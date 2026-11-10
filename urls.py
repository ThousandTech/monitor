from django.urls import path

from . import views

urlpatterns = [
    path("",views.index,name='index'),
    path("api/stats/",views.stats,name='stats'),
]