import { Module } from '@nestjs/common';
import { IgCatalogService } from './ig-catalog.service';

/**
 * Catálogo Instagram persistente (Postgres). `PrismaModule` é `@Global()`, por
 * isso basta prover/exportar o serviço. Em fases seguintes este módulo regista
 * também a fila BullMQ `media-backfill-v1`.
 */
@Module({
  providers: [IgCatalogService],
  exports: [IgCatalogService],
})
export class IgCatalogModule {}
