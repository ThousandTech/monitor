import platform
import time

import psutil
from django.core.cache import caches
from django.core.management.base import BaseCommand
from time import perf_counter

class Command(BaseCommand):
    help = "collect system data"

    def handle(self, *args, **options):

        monitor_cache = caches['monitor']

        system_description = platform.platform()

        psutil.cpu_percent(interval=None)

        self.stdout.write("Collect loop start.")

        try:
            while True:

                start_time = perf_counter()
                disk_before = psutil.disk_io_counters()
                net_before = psutil.net_io_counters()

                time.sleep(1)

                disk_after = psutil.disk_io_counters()
                net_after = psutil.net_io_counters()
                elapsed_time = perf_counter() - start_time

                memory = psutil.virtual_memory()

                snapshot = {
                    "update_at": time.time(),
                    "system": {
                        "version": system_description,
                    },
                    "cpu": {
                        "percent": psutil.cpu_percent(interval=None)
                    },
                    "memory": {
                        "total": memory.total,
                        "used": memory.used,
                        "percent": memory.percent,
                    },
                    "disk": {
                        "read_speed": self._calculate_rate(disk_before, disk_after, "read_bytes", elapsed_time),
                        "write_speed": self._calculate_rate(disk_before, disk_after, "write_bytes", elapsed_time),
                    },
                    "net": {
                        "read_speed": self._calculate_rate(net_before, net_after, "bytes_recv", elapsed_time),
                        "write_speed": self._calculate_rate(net_before, net_after, "bytes_sent", elapsed_time),
                    }}

                monitor_cache.set(
                    "system_stats",
                    snapshot,
                    timeout=5,
                )

        except KeyboardInterrupt:
            self.stdout.write("Collect loop end.")

    @staticmethod
    def _calculate_rate(before, after, field, elapsed_time):
        if before is None or after is None:
            return None

        if elapsed_time <= 0 or elapsed_time is None:
            return None

        difference = getattr(after, field) - getattr(before, field)

        if difference <= 0:
            return 0

        return difference / elapsed_time