CREATE UNIQUE INDEX "entity_addresses_chain_address_unique" ON "entity_addresses" USING btree (coalesce("chain_id", -1),lower("address"));
