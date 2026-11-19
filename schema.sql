-- SAMA BUSINESS V1 - PostgreSQL / Supabase
-- À exécuter dans Supabase SQL Editor avec un compte administrateur.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text,
 preferred_language text not null default 'fr' check (preferred_language in ('fr','wo','en')),
 created_at timestamptz not null default now()
);

create table if not exists public.businesses (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 country_code char(2) not null default 'SN',
 currency char(3) not null default 'XOF',
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);

create table if not exists public.business_members (
 business_id uuid not null references public.businesses(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null default 'owner' check (role in ('owner','manager','cashier','viewer')),
 created_at timestamptz not null default now(),
 primary key (business_id,user_id)
);

create table if not exists public.categories (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete cascade,
 name text not null,
 created_at timestamptz not null default now()
);

create table if not exists public.products (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete cascade,
 category_id uuid references public.categories(id) on delete set null,
 name text not null,
 sku text,
 sale_price bigint not null check (sale_price >= 0),
 purchase_cost bigint not null default 0 check (purchase_cost >= 0),
 stock_quantity numeric(14,3) not null default 0,
 low_stock_threshold numeric(14,3) not null default 5,
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists products_business_idx on public.products(business_id);

create table if not exists public.customers (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete cascade,
 name text not null,
 phone text,
 created_at timestamptz not null default now()
);

create table if not exists public.suppliers (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete cascade,
 name text not null,
 phone text,
 created_at timestamptz not null default now()
);

create table if not exists public.sales (
 id uuid primary key,
 business_id uuid not null references public.businesses(id) on delete cascade,
 sale_number text not null,
 payment_method text not null check (payment_method in ('cash','wave','orange_money','other')),
 total_amount bigint not null check (total_amount >= 0),
 status text not null default 'completed' check (status in ('completed','cancelled','refunded')),
 device_id uuid,
 occurred_at timestamptz not null,
 created_at timestamptz not null default now(),
 unique (business_id,sale_number)
);
create index if not exists sales_business_date_idx on public.sales(business_id,occurred_at desc);

create table if not exists public.sale_items (
 id uuid primary key default gen_random_uuid(),
 sale_id uuid not null references public.sales(id) on delete cascade,
 product_id uuid references public.products(id) on delete set null,
 product_name_snapshot text not null,
 quantity numeric(14,3) not null check (quantity > 0),
 unit_price bigint not null check (unit_price >= 0),
 unit_cost bigint not null default 0 check (unit_cost >= 0),
 line_total bigint not null check (line_total >= 0)
);

create table if not exists public.stock_movements (
 id uuid primary key,
 business_id uuid not null references public.businesses(id) on delete cascade,
 product_id uuid not null references public.products(id),
 movement_type text not null check (movement_type in ('opening','purchase','sale','adjustment','return')),
 quantity_delta numeric(14,3) not null,
 reference_id uuid,
 occurred_at timestamptz not null,
 created_at timestamptz not null default now()
);
create index if not exists stock_business_product_idx on public.stock_movements(business_id,product_id);

create table if not exists public.expenses (
 id uuid primary key,
 business_id uuid not null references public.businesses(id) on delete cascade,
 name text not null,
 amount bigint not null check (amount > 0),
 category text,
 occurred_at timestamptz not null,
 created_at timestamptz not null default now()
);

create table if not exists public.sync_operations (
 id uuid primary key,
 business_id uuid not null references public.businesses(id) on delete cascade,
 device_id uuid not null,
 operation_type text not null,
 payload jsonb not null,
 created_at timestamptz not null default now(),
 processed_at timestamptz,
 error_message text
);

create table if not exists public.subscriptions (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null unique references public.businesses(id) on delete cascade,
 plan text not null default 'starter' check (plan in ('starter','business','premium')),
 status text not null default 'trial' check (status in ('trial','active','past_due','cancelled')),
 current_period_end timestamptz,
 created_at timestamptz not null default now()
);

-- Security helper: membership is checked server-side for every tenant-owned row.
create or replace function public.is_business_member(target_business uuid)
returns boolean language sql stable security definer
set search_path = public
as $$
 select exists (
  select 1 from public.business_members bm
  where bm.business_id = target_business and bm.user_id = auth.uid()
 );
$$;

alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.suppliers enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.expenses enable row level security;
alter table public.sync_operations enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists "profile own read" on public.profiles;
create policy "profile own read" on public.profiles for select using (id = auth.uid());
drop policy if exists "profile own update" on public.profiles;
create policy "profile own update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- Business creation/member invitation must be performed through a trusted
-- server-side onboarding function in the production implementation.
create policy "members read own businesses" on public.businesses
for select using (public.is_business_member(id));
create policy "members read membership" on public.business_members
for select using (user_id = auth.uid() or public.is_business_member(business_id));

create policy "members manage categories" on public.categories
for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy "members manage products" on public.products
for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy "members manage customers" on public.customers
for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy "members manage suppliers" on public.suppliers
for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy "members manage sales" on public.sales
for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy "members read sale items" on public.sale_items
for all using (exists(select 1 from public.sales s where s.id=sale_id and public.is_business_member(s.business_id)))
with check (exists(select 1 from public.sales s where s.id=sale_id and public.is_business_member(s.business_id)));
create policy "members manage stock movements" on public.stock_movements
for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy "members manage expenses" on public.expenses
for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy "members manage sync operations" on public.sync_operations
for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy "members read subscriptions" on public.subscriptions
for select using (public.is_business_member(business_id));

-- IMPORTANT: This is a starter schema, not a complete production authorization model.
-- Add role-based write restrictions, audited RPCs for atomic sales/stock changes,
-- secure onboarding/invitations, rate limits, backup policies and automated tests
-- before onboarding real paying businesses.
